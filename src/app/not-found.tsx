import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div><h1 className="text-2xl font-bold">Not found</h1><p className="mt-2 text-gray-500">That page doesn&apos;t exist.</p><Link href="/" className="btn-primary mt-4">Back to the league</Link></div>
    </main>
  );
}
