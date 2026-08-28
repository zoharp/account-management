import type { ConnectionTestResult } from '@/lib/types';

/**
 * Three states, not two. `success === null` means "nothing configured to test"
 * and must read as neutral — showing it as a failure would make every account
 * without an Orcanos DB look broken.
 */
export default function TestResult({ result }: { result: ConnectionTestResult | null }) {
  if (!result) return null;

  if (result.success === null) {
    return <div className="acl-test-result acl-test--none">— {result.message}</div>;
  }

  return (
    <div className={`acl-test-result ${result.success ? 'acl-test--ok' : 'acl-test--err'}`}>
      {result.success ? `✓ ${result.message}` : `✗ ${result.error}`}
    </div>
  );
}
