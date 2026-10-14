import { useParams } from "react-router-dom";
import { FileBrowser } from "@/components/files/FileBrowser";

export default function FolderPage() {
  const { "*": path } = useParams();
  const folderPath = path ? `/${path}` : "/";

  return <FileBrowser folderPath={folderPath} mode="drive" />;
}

