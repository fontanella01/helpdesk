import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button, ErrorText, Field, Input } from "../components/ui";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ organizationName: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(form.email, form.password);
      else await register(form);
      navigate("/tickets");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isLogin = mode === "login";
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-ink p-12 text-white lg:flex">
        <span className="text-lg font-bold tracking-tight">
          Help<span className="text-brand-500">Desk</span>
        </span>
        <div className="max-w-md space-y-4">
          <h2 className="text-3xl font-bold leading-tight">Every customer request, in one place.</h2>
          <p className="text-slate-300">Open, prioritize and resolve support tickets with your team. Each company sees only its own data.</p>
        </div>
        <span className="text-sm text-slate-400">Portfolio project · React, TypeScript, Node.js, PostgreSQL</span>
      </aside>

      <main className="flex items-center justify-center px-4 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{isLogin ? "Sign in" : "Create your workspace"}</h1>
            <p className="text-sm text-slate-500">{isLogin ? "Welcome back." : "You will be the owner and can invite your team later."}</p>
          </div>

          {!isLogin && (
            <>
              <Field label="Company name">
                <Input id="org" required value={form.organizationName} onChange={set("organizationName")} placeholder="Acme Inc." />
              </Field>
              <Field label="Your name">
                <Input id="name" required value={form.name} onChange={set("name")} placeholder="Ana Souza" />
              </Field>
            </>
          )}
          <Field label="Email">
            <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} placeholder="you@company.com" />
          </Field>
          <Field label="Password">
            <Input
              id="password"
              type="password"
              required
              minLength={isLogin ? 1 : 8}
              autoComplete={isLogin ? "current-password" : "new-password"}
              value={form.password}
              onChange={set("password")}
              placeholder={isLogin ? "" : "At least 8 characters"}
            />
          </Field>

          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Please wait…" : isLogin ? "Sign in" : "Create workspace"}
          </Button>
          <p className="text-center text-sm text-slate-500">
            {isLogin ? "New here? " : "Already have an account? "}
            <Link to={isLogin ? "/register" : "/login"} className="font-semibold text-brand-600 hover:underline">
              {isLogin ? "Create a workspace" : "Sign in"}
            </Link>
          </p>
        </form>
      </main>
    </div>
  );
}
