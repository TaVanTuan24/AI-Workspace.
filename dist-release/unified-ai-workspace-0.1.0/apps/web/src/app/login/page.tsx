export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm rounded-md border border-border bg-panel p-5">
      <h1 className="text-lg font-semibold">Local Login</h1>
      <p className="mt-2 text-sm text-muted">
        MVP placeholder for local app authentication. Provider passwords are never entered here.
      </p>
      <form className="mt-4 space-y-3">
        <input className="w-full rounded-md border border-border p-2" placeholder="Email" type="email" />
        <input className="w-full rounded-md border border-border p-2" placeholder="Local password" type="password" />
        <button className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">
          Sign in
        </button>
      </form>
    </div>
  );
}
