import TBFTApp from "@/components/TBFTApp";
import RecurringTaskEnhancer from "@/components/RecurringTaskEnhancer";
import ArchivePermanentDeleteControls from "@/components/ArchivePermanentDeleteControls";
import ProjectWorkspaceEnhancerHost from "@/components/ProjectWorkspaceEnhancerHost";

export default function Home() {
  return (
    <>
      <TBFTApp />
      <RecurringTaskEnhancer />
      <ArchivePermanentDeleteControls />
      <ProjectWorkspaceEnhancerHost />
    </>
  );
}
