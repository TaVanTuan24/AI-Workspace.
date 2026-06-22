export function AuditLogTable({
  rows = []
}: {
  rows?: Array<{ action: string; provider?: string; result: string; createdAt: string }>;
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left">
          <th className="py-2">Action</th>
          <th className="py-2">Provider</th>
          <th className="py-2">Result</th>
          <th className="py-2">Time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.action}-${index}`} className="border-b border-border">
            <td className="py-2">{row.action}</td>
            <td className="py-2">{row.provider ?? "-"}</td>
            <td className="py-2">{row.result}</td>
            <td className="py-2">{row.createdAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
