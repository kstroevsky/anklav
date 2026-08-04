# Retrieval evaluation

Retrieval profiles and ranking weights are baselines until a versioned benchmark demonstrates that a change improves quality. Run a suite through `POST /api/v1/workspaces/:workspaceId/retrieval/evaluations`; every case uses the production retrieval path and returns the retrieval trace ID needed to reproduce its candidates, filters, profile revision, and scoring weights. The report also returns a canonical SHA-256 hash of the suite definition, independent of the selected profile and thresholds, so profile comparisons can prove they used the same corpus and judgments.

Full suites must cover all eight categories: accepted-decision recall, current-versus-obsolete precision, exact errors, related tasks, Git-slice relevance, provenance, conflict resolution, and cross-project leakage. This is enforced by the default `requiredCategories`; a focused diagnostic suite may declare a smaller list explicitly. Expected references may constrain `sourceType`, `sourceId`, semantic `sourcePart`, validity `status`, and a deep subset of metadata such as `effectiveFromCommit` or evidence IDs. Forbidden references identify obsolete or contradicted sources that must not intrude.

The default safety gates require zero forbidden intrusion, zero cross-project leakage, complete provenance coverage, at least 0.8 recall at K, 0.7 mean reciprocal rank, 0.95 current precision, and a case pass rate of at least 0.8. A case itself passes only when all expected references are present, no forbidden or leaked result appears, every result has a stable source tuple and content hash, and a non-historical query returns only current results.

```json
{
  "suiteId": "anklav-retrieval-regression",
  "suiteVersion": "1.0.0",
  "projectId": "0198babc-1234-7000-8000-000000000001",
  "embeddingProfileKey": "nomic-v2-768",
  "requiredCategories": ["git_slice"],
  "cases": [
    {
      "id": "active-storage-decision",
      "category": "git_slice",
      "query": "Why is PostgreSQL the canonical memory store?",
      "intent": "architectural_decision",
      "expectedRefs": [
        {
          "sourceType": "decision",
          "sourceId": "0198babc-1234-7000-8000-000000000010",
          "status": "current",
          "metadata": { "effectiveFromCommit": "abc1234" }
        }
      ],
      "forbiddenRefs": [
        { "sourceType": "decision", "sourceId": "0198babc-1234-7000-8000-000000000011" }
      ]
    }
  ]
}
```

To compare dimensions or models, keep the suite and corpus unchanged, run it once per revision-pinned embedding profile, and compare the returned gates and per-category pass rates. Do not promote a profile merely because its aggregate semantic score is higher; the zero-leakage and zero-obsolete-intrusion gates remain non-negotiable.
