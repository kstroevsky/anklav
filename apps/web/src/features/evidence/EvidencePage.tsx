import type { Workspace } from '../../api';
import { Page } from '../../components/templates/Page';
import { EvidenceBrowser } from './EvidenceBrowser';
import { EvidenceComposer } from './EvidenceComposer';

export function EvidencePage({ workspace }: { workspace: Workspace }) {
  return <Page heading="Evidence" subheading="Inspect, verify, record, and download the exact artifacts behind agent work."><EvidenceComposer workspace={workspace} /><EvidenceBrowser workspace={workspace} /></Page>;
}
