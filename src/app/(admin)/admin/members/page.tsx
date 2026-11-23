import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/auth/rights';
import { listAdminMembers } from '@/lib/auth/members';
import { MemberActionsMenu } from '@/components/admin/MemberActionsMenu';
import type { UserApiAccountBlock } from '@/types';

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function StatusBadge({
  status,
  statusExpiresAt,
  statusReason,
}: {
  status: 'active' | 'kicked' | 'banned';
  statusExpiresAt: string | null;
  statusReason: string | null;
}) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        Active
      </span>
    );
  }
  if (status === 'kicked') {
    const expiresLabel =
      statusExpiresAt !== null
        ? `until ${DATE_FORMAT.format(new Date(statusExpiresAt))}`
        : 'no expiry';
    return (
      <span
        className="inline-flex items-center rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
        title={statusReason ?? undefined}
      >
        Kicked ({expiresLabel})
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      title={statusReason ?? undefined}
    >
      Banned
    </span>
  );
}

function ApiBlockBadge({ block }: { block: UserApiAccountBlock }) {
  const until =
    block.until === null
      ? 'until an admin lifts it'
      : `until ${DATE_FORMAT.format(new Date(block.until))}`;
  return (
    <span
      className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      title={block.reason === null ? until : `${until}: ${block.reason}`}
    >
      API blocked
    </span>
  );
}

function AuthzBadge({ level }: { level: 'member' | 'admin' }) {
  if (level === 'admin') {
    return (
      <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        Admin
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Member</span>;
}

export default async function AdminMembersPage() {
  const session = await auth();
  if (!(await isAdmin(session))) redirect('/maps');
  const members = await listAdminMembers();

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
      </header>

      {members.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No members.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Corp</th>
                <th className="px-3 py-2 font-medium">Level</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="w-px px-3 py-2 font-medium" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="px-3 py-2 align-middle font-medium">{m.name}</td>
                  <td className="px-3 py-2 align-middle text-muted-foreground">
                    {m.corporationId ?? '—'}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <AuthzBadge level={m.authzLevel} />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge
                        status={m.status}
                        statusExpiresAt={m.statusExpiresAt}
                        statusReason={m.statusReason}
                      />
                      {m.apiBlock !== null && <ApiBlockBadge block={m.apiBlock} />}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-middle text-muted-foreground">
                    {m.lastLocationAt !== null
                      ? DATE_FORMAT.format(new Date(m.lastLocationAt))
                      : '—'}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <MemberActionsMenu member={m} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
