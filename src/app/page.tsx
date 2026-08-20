import TBFTApp from "@/components/TBFTApp";
import RecurringTaskEnhancer from "@/components/RecurringTaskEnhancer";
import ArchivePermanentDeleteControls from "@/components/ArchivePermanentDeleteControls";
import ProjectWorkspaceEnhancerHost from "@/components/ProjectWorkspaceEnhancerHost";
import ProjectArchiveVisibilityGuard from "@/components/ProjectArchiveVisibilityGuard";
import GoogleDriveSettings from "@/components/GoogleDriveSettings";
import GoogleDriveHierarchySync from "@/components/GoogleDriveHierarchySync";
import BackgroundSettings from "@/components/BackgroundSettings";

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
      <BackgroundSettings />
    </>
  );
}
