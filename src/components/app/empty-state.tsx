export function EmptyState({ icon, children, large }: { icon?: React.ReactNode; children: React.ReactNode; large?: boolean }) {
  return (
    <div className={`rounded-lg border border-dashed ${large ? "p-12" : "p-8"} text-center text-sm text-muted-foreground`}>
      {icon && <div className="mx-auto mb-3">{icon}</div>}
      {children}
    </div>
  );
}
