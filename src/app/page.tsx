import { listBooks } from "@/lib/books";
import LibraryView from "@/components/library/LibraryView";

export const dynamic = "force-dynamic";

export default async function Home() {
  const books = await listBooks();
  return <LibraryView books={books} />;
}
