"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function SignupForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, display_name: displayName || undefined })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Unable to create your account.");
      }
      router.push(payload.data?.session ? "/dashboard" : "/login");
      router.refresh();
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : "Unable to create your account.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      {error ? <div className="alert" role="alert">{error}</div> : null}
      <div className="field">
        <label htmlFor="signup-name">Name <span style={{ color: "var(--slate)", fontWeight: 400 }}>(optional)</span></label>
        <Input id="signup-name" type="text" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="signup-email">Email address</label>
        <Input id="signup-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="signup-password">Password</label>
        <Input id="signup-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
        <p className="field-help">Use at least 8 characters.</p>
      </div>
      <Button className="button-full" type="submit" loading={loading}>
        {loading ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}