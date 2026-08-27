import type { SupabaseClient } from "@supabase/supabase-js";
import { getTaskFileSpace, listTaskFiles, uploadProjectFile } from "@/lib/projectStorage";

type TaskPdfRow = {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  owner_user_id: string;
  created_by: string;
  original_date: string;
  deadline: string | null;
  priority: string;
  project_id: string | null;
  project_node_id: string | null;
  completion_note: string | null;
  created_at: string;
};

type PdfMetadata = {
  workspace: string;
  creator: string;
  owner: string;
  project: string;
  phase: string;
  taskDate: string;
  deadline: string;
  priority: string;
  createdAt: string;
  completedAt: string;
  taskId: string;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 52;
const RIGHT = 543;
const FOOTER_Y = 54;

function ascii(value: string): string {
  const replaced = value
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("Ä", "Ae")
    .replaceAll("Ö", "Oe")
    .replaceAll("Ü", "Ue")
    .replaceAll("ß", "ss")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  return replaced.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function pdfEscape(value: string): string {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function textCommand(text: string, x: number, y: number, size: number, bold = false, gray = 0): string {
  return `${gray.toFixed(2)} g BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${pdfEscape(text)}) Tj ET\n`;
}

function wrapLine(text: string, maxChars: number): string[] {
  const clean = ascii(text).replace(/\t/g, "    ").trimEnd();
  if (!clean.trim()) return [""];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function wrapParagraphs(text: string, maxChars: number): string[] {
  const result: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!raw.trim()) {
      result.push("");
      continue;
    }
    result.push(...wrapLine(raw, maxChars));
  }
  while (result.length && result[result.length - 1] === "") result.pop();
  return result;
}

function truncateLine(text: string, maxChars: number): string {
  const clean = ascii(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function formatTimestamp(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
}

function fileStamp(value: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}_${parts.hour}-${parts.minute}-${parts.second}`;
}

function safeFilenameTitle(value: string): string {
  return ascii(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 56) || "Task";
}

function footerCommands(metadata: PdfMetadata, page: number, totalPages: number): string {
  const line1 = truncateLine(
    `Workspace: ${metadata.workspace} | Creator: ${metadata.creator} | Owner: ${metadata.owner} | Project: ${metadata.project}`,
    118,
  );
  const line2 = truncateLine(
    `Task date: ${metadata.taskDate} | Completed: ${metadata.completedAt} | Priority: ${metadata.priority} | Task ID: ${metadata.taskId}`,
    118,
  );
  let output = "0.82 G 52 76 m 543 76 l S\n";
  output += textCommand(line1, LEFT, FOOTER_Y + 8, 7.2, false, 0.45);
  output += textCommand(line2, LEFT, FOOTER_Y - 3, 7.2, false, 0.45);
  output += textCommand(`Page ${page} of ${totalPages}`, 492, FOOTER_Y - 3, 7.2, false, 0.45);
  return output;
}

function buildPdf(input: {
  title: string;
  description: string;
  note: string;
  metadata: PdfMetadata;
}): Uint8Array {
  const noteLines = wrapParagraphs(input.note, 92);
  const firstCapacity = 29;
  const continuationCapacity = 47;
  const chunks: string[][] = [];
  chunks.push(noteLines.slice(0, firstCapacity));
  let cursor = firstCapacity;
  while (cursor < noteLines.length) {
    chunks.push(noteLines.slice(cursor, cursor + continuationCapacity));
    cursor += continuationCapacity;
  }
  if (!chunks.length) chunks.push([]);

  const totalPages = chunks.length;
  const pageStreams = chunks.map((lines, pageIndex) => {
    let out = "";
    if (pageIndex === 0) {
      out += textCommand("TBFT TASK NOTES", LEFT, 792, 10, true, 0.40);
      out += textCommand(truncateLine(input.title, 62), LEFT, 759, 22, true, 0.08);
      out += textCommand("Completed task record", LEFT, 738, 10.5, false, 0.48);
      out += "0.90 G 52 719 m 543 719 l S\n";

      out += "0.96 g 52 614 491 88 re f\n";
      out += textCommand("PROJECT", 66, 684, 7.5, true, 0.46);
      out += textCommand(truncateLine(input.metadata.project, 34), 66, 669, 10.5, true, 0.12);
      out += textCommand("OWNER", 310, 684, 7.5, true, 0.46);
      out += textCommand(truncateLine(input.metadata.owner, 30), 310, 669, 10.5, true, 0.12);
      out += textCommand("TASK DATE", 66, 647, 7.5, true, 0.46);
      out += textCommand(`${input.metadata.taskDate}${input.metadata.deadline ? ` at ${input.metadata.deadline}` : ""}`, 66, 632, 10, false, 0.12);
      out += textCommand("COMPLETED", 310, 647, 7.5, true, 0.46);
      out += textCommand(truncateLine(input.metadata.completedAt, 34), 310, 632, 10, false, 0.12);

      if (input.description.trim()) {
        out += textCommand("TASK DESCRIPTION", LEFT, 582, 8, true, 0.46);
        const descriptionLines = wrapParagraphs(input.description, 92).slice(0, 3);
        let descriptionY = 566;
        for (const line of descriptionLines) {
          out += textCommand(truncateLine(line, 92), LEFT, descriptionY, 9.5, false, 0.22);
          descriptionY -= 13;
        }
      }

      out += textCommand("NOTES", LEFT, 516, 9, true, 0.35);
      out += "0.90 G 52 506 m 543 506 l S\n";
      let y = 486;
      for (const line of lines) {
        if (!line) {
          y -= 8;
          continue;
        }
        out += textCommand(line, LEFT, y, 10.5, false, 0.10);
        y -= 14;
      }
    } else {
      out += textCommand("TBFT TASK NOTES", LEFT, 792, 9.5, true, 0.42);
      out += textCommand(truncateLine(input.title, 78), LEFT, 768, 15, true, 0.10);
      out += "0.90 G 52 751 m 543 751 l S\n";
      let y = 730;
      for (const line of lines) {
        if (!line) {
          y -= 8;
          continue;
        }
        out += textCommand(line, LEFT, y, 10.5, false, 0.10);
        y -= 14;
      }
    }
    out += footerCommands(input.metadata, pageIndex + 1, totalPages);
    return out;
  });

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  const pageIds: number[] = [];
  for (let index = 0; index < pageStreams.length; index += 1) {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    const stream = pageStreams[index];
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  }
  objects[2] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;

  let pdf = "%PDF-1.4\n%TBFT\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

async function authHeader(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Your TBFT session expired. Sign in again.");
  return { authorization: `Bearer ${data.session.access_token}`, "content-type": "application/json" };
}

async function ensureTaskFileSpace(supabase: SupabaseClient, taskId: string, workspaceId: string) {
  let space = await getTaskFileSpace(supabase, taskId);
  if (space) return space;
  const response = await fetch("/api/google-drive/sync", {
    method: "POST",
    headers: await authHeader(supabase),
    body: JSON.stringify({ workspaceId }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "Task folder could not be prepared for the PDF.");
  }
  space = await getTaskFileSpace(supabase, taskId);
  if (!space) throw new Error("Task folder is not available yet. Sync Google Drive and try again.");
  return space;
}

export async function saveTaskCompletionPdf(
  supabase: SupabaseClient,
  taskId: string,
  completedAt: string,
  userId: string,
): Promise<string | null> {
  const { data: taskData, error: taskError } = await supabase
    .from("tasks")
    .select("id, workspace_id, title, description, owner_user_id, created_by, original_date, deadline, priority, project_id, project_node_id, completion_note, created_at")
    .eq("id", taskId)
    .single();
  if (taskError || !taskData) throw new Error(taskError?.message ?? "Task could not be loaded for PDF export.");
  const task = taskData as TaskPdfRow;
  const note = task.completion_note?.trim() ?? "";
  if (!note) return null;

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("name, timezone")
    .eq("id", task.workspace_id)
    .single();
  if (workspaceError || !workspace) throw new Error(workspaceError?.message ?? "Workspace metadata could not be loaded.");
  const timeZone = (workspace.timezone as string | null) || "UTC";

  const profileIds = Array.from(new Set([task.created_by, task.owner_user_id]));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", profileIds);
  const profileMap = new Map((profiles ?? []).map((row) => [row.id as string, (row.display_name as string | null) || "Partner"]));

  let projectName = "No project";
  if (task.project_id) {
    const { data: project } = await supabase.from("projects").select("name").eq("id", task.project_id).maybeSingle();
    if (project?.name) projectName = String(project.name);
  }

  let phaseName = "";
  if (task.project_node_id) {
    const { data: node } = await supabase.from("project_nodes").select("title").eq("id", task.project_node_id).maybeSingle();
    if (node?.title) phaseName = String(node.title);
  }

  const filename = `Task Notes - ${safeFilenameTitle(task.title)} - ${fileStamp(completedAt, timeZone)}.pdf`;
  const existingFiles = await listTaskFiles(supabase, task.id);
  if (existingFiles.some((file) => file.originalName === filename)) return filename;

  const metadata: PdfMetadata = {
    workspace: String(workspace.name || "TBFT"),
    creator: profileMap.get(task.created_by) ?? "Partner",
    owner: profileMap.get(task.owner_user_id) ?? "Partner",
    project: phaseName ? `${projectName} / ${phaseName}` : projectName,
    phase: phaseName,
    taskDate: task.original_date,
    deadline: task.deadline ? task.deadline.slice(0, 5) : "",
    priority: task.priority,
    createdAt: formatTimestamp(task.created_at, timeZone),
    completedAt: formatTimestamp(completedAt, timeZone),
    taskId: task.id,
  };

  const bytes = buildPdf({
    title: task.title,
    description: task.description ?? "",
    note,
    metadata,
  });
  const pdfBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(pdfBuffer).set(bytes);
  const file = new File([pdfBuffer], filename, { type: "application/pdf", lastModified: Date.now() });
  const space = await ensureTaskFileSpace(supabase, task.id, task.workspace_id);
  await uploadProjectFile(supabase, {
    workspaceId: task.workspace_id,
    projectId: task.project_id ?? undefined,
    taskId: task.id,
    userId,
    file,
    provider: space.provider,
  });
  return filename;
}
