export function SecuritySettingsPanel() {
  return (
    <section className="rounded-md border border-border bg-panel p-4">
      <h2 className="font-semibold">Security Settings</h2>
      <div className="mt-4 space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" defaultChecked />
          Store provider sessions encrypted at rest
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" defaultChecked />
          Redact session-like fields from logs
        </label>
      </div>
    </section>
  );
}
