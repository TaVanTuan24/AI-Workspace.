"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { acceptWorkspaceInvite } from "../../../lib/api";
import { ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Invalid or missing invite token.");
    }
  }, [token]);

  async function handleAccept() {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      await acceptWorkspaceInvite(token);
      setSuccess(true);
      
      // Wait a moment before redirecting to allow user to read success message
      setTimeout(() => {
        // Force a hard reload to / so the new workspace is loaded into context
        window.location.href = "/";
      }, 1500);
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to accept invite"));
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Invite Accepted!</h1>
          <p className="text-slate-400">Redirecting to your new workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-100">Workspace Invite</h1>
          <p className="mt-2 text-sm text-slate-400">
            You have been invited to join a workspace.
          </p>
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>{error}</div>
          </div>
        ) : null}

        {!error && token ? (
          <button
            onClick={handleAccept}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Accepting...
              </>
            ) : (
              "Accept Invite"
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function friendlyError(message: string) {
  const map: Record<string, string> = {
    invite_not_found: "This invite does not exist or has been removed.",
    invite_expired: "This invite has expired.",
    invite_already_accepted: "This invite has already been accepted.",
    invite_revoked: "This invite has been revoked by the workspace owner.",
    invalid_role: "The role specified in the invite is invalid.",
    already_member: "You are already a member of this workspace.",
    already_invited: "You already have a pending invite.",
    email_mismatch: "This invite was sent to a different email address."
  };
  return map[message] ?? message;
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
        <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
      </div>
    }>
      <AcceptInviteContent />
    </Suspense>
  );
}
