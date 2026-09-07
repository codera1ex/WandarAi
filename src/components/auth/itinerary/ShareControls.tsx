"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/Input";

export function ShareControls({ tripId }: { tripId: string }) {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  function buildShareUrl(token: string) {
    if (typeof window === "undefined") return token;
    return `${window.location.origin}/share/${token}`;
  }

  async function handleCreate() {
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const response = await fetch(`/api/trips/${tripId}/share`, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to create a share link.");
      }
      setShareUrl(buildShareUrl(payload.data.token));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create a share link.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    if (!window.confirm("Revoke this share link? Anyone with the old link will lose access.")) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/share`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to revoke the share link.");
      }
      setShareUrl(null);
      setCopied(false);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Unable to revoke the share link.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically — please copy the link manually.");
    }
  }

  return (
    <div className="share-controls">
      <div className="share-controls-header">
        <h3><Icon name="share" size={15} /> Share this trip</h3>
        <p>Anyone with the link can view a read-only copy of this itinerary. They can&apos;t edit it.</p>
      </div>

      {error ? <div className="alert" role="alert">{error}</div> : null}

      {shareUrl ? (
        <div className="share-link-row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="share-link-url" className="sr-only">Shareable itinerary link</label>
            <Input id="share-link-url" type="text" readOnly value={shareUrl} />
          </div>
          <button type="button" className="icon-button" onClick={handleCopy} aria-label="Copy share link">
            <Icon name={copied ? "check" : "copy"} size={16} />
          </button>
          <Button type="button" variant="danger" onClick={handleRevoke} disabled={loading}>
            Revoke
          </Button>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={handleCreate} loading={loading}>
          <Icon name="share" size={15} /> Create share link
        </Button>
      )}
    </div>
  );
}
