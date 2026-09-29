'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth, ApiError } from '@/lib/auth-context';

const initialForm = {
  tenantName: '',
  legalName: '',
  document: '',
  slug: '',
  branchName: 'Matriz',
  userName: '',
  email: '',
  password: '',
};

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function update<K extends keyof typeof initialForm>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await register(form);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a conta.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
        <h1 className="text-xl font-semibold">Criar restaurante</h1>

        <Field label="Nome do restaurante" value={form.tenantName} onChange={(v) => update('tenantName', v)} />
        <Field label="Razão social" value={form.legalName} onChange={(v) => update('legalName', v)} />
        <Field
          label="CNPJ/CPF (somente números)"
          value={form.document}
          onChange={(v) => update('document', v)}
        />
        <Field label="Slug (URL)" value={form.slug} onChange={(v) => update('slug', v)} />
        <Field label="Nome da unidade" value={form.branchName} onChange={(v) => update('branchName', v)} />
        <Field label="Seu nome" value={form.userName} onChange={(v) => update('userName', v)} />
        <Field
          label="Seu e-mail"
          type="email"
          value={form.email}
          onChange={(v) => update('email', v)}
        />
        <Field
          label="Senha (mín. 8 caracteres)"
          type="password"
          minLength={8}
          value={form.password}
          onChange={(v) => update('password', v)}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Criando...' : 'Criar restaurante'}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Já tem uma conta?{' '}
          <Link href="/login" className="font-medium text-foreground underline">
            Entrar
          </Link>
        </p>
      </form>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  minLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  minLength?: number;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <Input
        type={type}
        required
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
