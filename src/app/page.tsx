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
import ProjectFileRecoveryEnhancer from "@/components/ProjectFileRecoveryEnhancer";
import TaskDetailEnhancer from "@/components/TaskDetailEnhancer";

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
      <ProjectFileRecoveryEnhancer />
      <TaskDetailEnhancer />
    </>
  );
}
