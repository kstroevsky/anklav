import type { Workspace } from '../../api';
import { Page } from '../../components/templates/Page';
import { EvidenceBrowser } from './EvidenceBrowser';

export function EvidencePage({ workspace }: { workspace: Workspace }) {
  return <Page heading="Evidence" subheading="Inspect and download the exact artifacts behind agent work and verification."><EvidenceBrowser workspace={workspace} /></Page>;
}
