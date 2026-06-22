export default function SecuritySettingsPage() {
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Security</h1>
      <section className="rounded-md border border-border bg-panel p-4">
        <h2 className="font-semibold">Session Vault</h2>
        <p className="mt-2 text-sm text-muted">
          Provider browser session state is encrypted before storage. Decryption is performed only
          inside the worker process while a provider job is running.
        </p>
      </section>
      <section className="rounded-md border border-border bg-panel p-4">
        <h2 className="font-semibold">Audit Log</h2>
        <p className="mt-2 text-sm text-muted">
          Audit entries should store safe metadata only. Do not store cookies, tokens, localStorage,
          sessionStorage, page HTML, or login screenshots.
        </p>
      </section>
    </div>
  );
}
