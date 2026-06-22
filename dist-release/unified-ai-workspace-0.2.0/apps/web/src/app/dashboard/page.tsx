import Link from "next/link";

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Link className="rounded-md border border-border bg-panel p-4 hover:bg-white" href="/connections">
          <h2 className="font-semibold">Connections</h2>
          <p className="mt-1 text-sm text-muted">Connect or disconnect personal provider sessions.</p>
        </Link>
        <Link className="rounded-md border border-border bg-panel p-4 hover:bg-white" href="/chat">
          <h2 className="font-semibold">Chat</h2>
          <p className="mt-1 text-sm text-muted">Send prompts to one or more connected providers.</p>
        </Link>
      </div>
    </div>
  );
}
