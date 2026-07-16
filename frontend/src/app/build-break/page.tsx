// Throwaway alerting probe: this import does not resolve, so `next build`
// fails and Vercel reports a failed production deploy. Revert this commit
// once the deploy-failure alert is verified.
import "./__does_not_exist__";

export default function BuildBreak() {
  return null;
}
