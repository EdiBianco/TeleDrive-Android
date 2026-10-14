import { useSearchParams } from "react-router-dom";
import { FileBrowser } from "@/components/files/FileBrowser";

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";

  return <FileBrowser mode="search" searchQuery={query} />;
}
