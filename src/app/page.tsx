import "./task-detail.css";

import TBFTApp from "@/components/TBFTApp";
import RecurringTaskEnhancer from "@/components/RecurringTaskEnhancer";
import ArchivePermanentDeleteControls from "@/components/ArchivePermanentDeleteControls";
import ProjectWorkspaceEnhancerHost from "@/components/ProjectWorkspaceEnhancerHost";
import ProjectArchiveVisibilityGuard from "@/components/ProjectArchiveVisibilityGuard";
import GoogleDriveSettings from "@/components/GoogleDriveSettings";
import GoogleDriveHierarchySync from "@/components/GoogleDriveHierarchySync";
import FuckingDarkEnhancer from "@/components/FuckingDarkEnhancer";
import WorkspaceBrandEnhancer from "@/components/WorkspaceBrandEnhancer";
import TaskFilesEnhancer from "@/components/TaskFilesEnhancer";
import TaskCompletionPdfSync from "@/components/TaskCompletionPdfSync";
import ProjectFileRecoveryEnhancer from "@/components/ProjectFileRecoveryEnhancer";
import TaskDetailEnhancer from "@/components/TaskDetailEnhancer";
import SidebarCollapseEnhancer from "@/components/SidebarCollapseEnhancer";
import CalendarSyncEnhancer from "@/components/CalendarSyncEnhancer";

export default function Home() {
  return (
    <>
      <TBFTApp />
      <RecurringTaskEnhancer />
      <ArchivePermanentDeleteControls />
      <ProjectWorkspaceEnhancerHost />
      <ProjectArchiveVisibilityGuard />
      <GoogleDriveSettings />
      <GoogleDriveHierarchySync />
      <FuckingDarkEnhancer />
      <WorkspaceBrandEnhancer />
      <TaskFilesEnhancer />
      <TaskCompletionPdfSync />
      <ProjectFileRecoveryEnhancer />
      <TaskDetailEnhancer />
      <SidebarCollapseEnhancer />
      <CalendarSyncEnhancer />
    </>
  );
}
