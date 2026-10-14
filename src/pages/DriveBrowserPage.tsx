import { useParams } from "react-router-dom";
import { FileBrowser } from "@/components/files/FileBrowser";

interface DriveBrowserPageProps {
  root?: boolean;
}

export default function DriveBrowserPage({ root = false }: DriveBrowserPageProps) {
  const { "*": path } = useParams();
  const folderPath = root ? "/" : path ? `/${path}` : "/";

  return <FileBrowser folderPath={folderPath} mode="drive" />;
}
