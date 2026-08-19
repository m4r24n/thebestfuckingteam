import TBFTApp from "@/components/TBFTApp";
import RecurringTaskEnhancer from "@/components/RecurringTaskEnhancer";
import ArchivePermanentDeleteControls from "@/components/ArchivePermanentDeleteControls";

export default function Home() {
  return (
    <>
      <TBFTApp />
      <RecurringTaskEnhancer />
      <ArchivePermanentDeleteControls />
    </>
  );
}
