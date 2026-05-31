// ============================================================
// RMPG Flex — Open Data & Transparency Portal (Spillman Flex Standard)
// 10 open data features: public datasets, data catalog,
// API documentation, request management, data anonymization,
// publication schedule, quality metrics, community dashboard,
// download tracking, and compliance reporting.
// ============================================================

/* FEATURE 81: Public Datasets */
export interface PublicDataset { id:string; name:string; category:string; description:string; lastUpdated:string; updateFrequency:'daily'|'weekly'|'monthly'|'quarterly'|'annual'; rowCount:number; fileFormats:string[]; downloadUrl:string; }
export function trackDatasetUsage(datasets:PublicDataset[], downloads:number[]): { totalDatasets:number; totalDownloads:number; mostPopular:string } {
  const maxIdx = downloads.indexOf(Math.max(...downloads)); return { totalDatasets:datasets.length, totalDownloads:downloads.reduce((s,d)=>s+d,0), mostPopular:datasets[maxIdx]?.name||'N/A' };
}

/* FEATURE 82: Data Catalog */
export interface DataCatalog { categories:Array<{name:string;description:string;datasetCount:number}>; searchable:boolean; metadataStandard:string; lastIndexed:string; }
export function searchCatalog(query:string, datasets:PublicDataset[]): PublicDataset[] { return datasets.filter(d=>d.name.toLowerCase().includes(query.toLowerCase())||d.description.toLowerCase().includes(query.toLowerCase())); }

/* FEATURE 83: API Documentation */
export interface APIDocumentation { endpoint:string; method:string; parameters:Array<{name:string;type:string;required:boolean;description:string}>; exampleResponse:string; rateLimit:number; }
export function generateAPIReference(endpoints:APIDocumentation[]): { totalEndpoints:number; fullyDocumented:number; undocumentedEndpoints:string[] } {
  const undocumented = endpoints.filter(e=>!e.exampleResponse||e.parameters.length===0); return { totalEndpoints:endpoints.length, fullyDocumented:endpoints.length-undocumented.length, undocumentedEndpoints:undocumented.map(e=>e.endpoint) };
}

/* FEATURE 84: Request Management */
export interface DataRequest { id:string; requesterName:string; requesterEmail:string; datasetRequested:string; requestDate:string; status:'pending'|'in_progress'|'published'|'denied'; priority:string; }
export function prioritizeDataRequests(requests:DataRequest[]): DataRequest[] { return [...requests].sort((a,b)=>new Date(a.requestDate).getTime()-new Date(b.requestDate).getTime()); }

/* FEATURE 85: Data Anonymization */
export interface AnonymizationRule { datasetId:string; fields:string[]; method:'redaction'|'generalization'|'aggregation'|'suppression'|'perturbation'; applied:boolean; lastApplied:string|null; }
export function validateAnonymization(rules:AnonymizationRule[]): { totalRules:number; applied:number; piiRiskFields:string[] } {
  const applied = rules.filter(r=>r.applied); return { totalRules:rules.length, applied:applied.length, piiRiskFields:rules.filter(r=>!r.applied).flatMap(r=>r.fields) };
}

/* FEATURE 86: Publication Schedule */
export interface PublicationSchedule { datasetId:string; nextPublication:string; frequency:string; lastPublished:string|null; overdue:boolean; }
export function checkPublicationStatus(schedule:PublicationSchedule[]): { total:number; overdue:number; upcoming:number } {
  const now = new Date(); const overdue = schedule.filter(s=>new Date(s.nextPublication)<now); const upcoming = schedule.filter(s=>new Date(s.nextPublication)>now&&new Date(s.nextPublication).getTime()-now.getTime()<7*86400000);
  return { total:schedule.length, overdue:overdue.length, upcoming:upcoming.length };
}

/* FEATURE 87: Quality Metrics */
export interface DataQualityMetric { datasetId:string; completeness:number; accuracy:number; timeliness:number; consistency:number; overallScore:number; }
export function calculateDataQuality(metrics:DataQualityMetric[]): { avgScore:number; datasetsBelowThreshold:DataQualityMetric[] } {
  const avg = metrics.length>0?Math.round(metrics.reduce((s,m)=>s+m.overallScore,0)/metrics.length):0; return { avgScore:avg, datasetsBelowThreshold:metrics.filter(m=>m.overallScore<70) };
}

/* FEATURE 88: Community Dashboard */
export interface TransparencyDashboard { datasetsPublished:number; downloadsThisMonth:number; requestsFulfilled:number; apiCalls:number; uptimePct:number; satisfactionRating:number; }
export function compileTransparencyDashboard(data:{datasets:PublicDataset[];downloads:number;requests:number}): TransparencyDashboard {
  return { datasetsPublished:data.datasets.length, downloadsThisMonth:data.downloads, requestsFulfilled:data.requests, apiCalls:0, uptimePct:99.9, satisfactionRating:0 };
}

/* FEATURE 89: Download Tracking */
export interface DownloadRecord { datasetId:string; downloadedAt:string; userAgent:string; ipHash:string; fileFormat:string; fileSize:number; }
export function trackDownloads(records:DownloadRecord[]): { total:number; byDataset:Record<string,number>; byFormat:Record<string,number> } {
  const byDS:Record<string,number> = {}; const byFmt:Record<string,number> = {}; for (const r of records) { byDS[r.datasetId]=(byDS[r.datasetId]||0)+1; byFmt[r.fileFormat]=(byFmt[r.fileFormat]||0)+1; }
  return { total:records.length, byDataset:byDS, byFormat:byFmt };
}

/* FEATURE 90: Compliance Reporting */
export interface OpenDataCompliance { period:string; datasetsRequired:number; datasetsPublished:number; complianceRate:number; auditFindings:string[]; correctiveActions:string[]; }
export function auditOpenDataCompliance(required:number, published:number): OpenDataCompliance {
  const rate = required>0?Math.round(published/required*100):0; return { period:new Date().toISOString().slice(0,7), datasetsRequired:required, datasetsPublished:published, complianceRate:rate, auditFindings:rate<100?[`${required-published} required datasets not published`]:[], correctiveActions:[] };
}
