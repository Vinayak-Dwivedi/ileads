import { sanitizeNextPath, withBasePath } from "@/lib/base-path";

interface PageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const hasError = params.error === "1";
  const nextParam = params.next ? sanitizeNextPath(params.next) : "";
  const loginUrl = withBasePath("/api/auth/login");
  const action = nextParam ? `${loginUrl}?next=${encodeURIComponent(nextParam)}` : loginUrl;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[linear-gradient(135deg,#eef3fb_0%,#f7f9fc_35%,#f3f6fb_100%)] p-4">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-[0_8px_24px_rgba(16,24,40,0.08)] p-8">
        <div className="flex justify-center mb-6">
          <img src={withBasePath("/ileads-logo.png")} alt="iLeads" className="h-auto w-32" />
        </div>
        <h2 className="text-2xl font-semibold text-slate-800 mb-1.5">Sign in</h2>
        <p className="text-sm text-slate-500 mb-6">
          Enter the workspace password to access the QMS dashboard.
        </p>
        <form method="post" action={action} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-xs text-slate-500 mb-1.5">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
              autoFocus
              className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          {hasError ? (
            <p className="text-sm text-red-600">Incorrect password. Try again.</p>
          ) : null}
          <button
            type="submit"
            className="h-11 w-full rounded-lg bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
