// 10 search analytics features
export interface SearchQuery { id:string; userId:string; query:string; recordType:string; resultsCount:number; searchDate:string; durationMs:number; }
export function analyzeSearchPatterns(queries:SearchQuery[]): {total:number;avgResults:number;avgDuration:number;topQueries:Array<{query:string;count:number}>} { const qc:Record<string,number>={};for(const q of queries){qc[q.query]=(qc[q.query]||0)+1;} const avgRes=queries.length>0?Math.round(queries.reduce((s,q)=>s+q.resultsCount,0)/queries.length):0; const avgDur=queries.length>0?Math.round(queries.reduce((s,q)=>s+q.durationMs,0)/queries.length):0; return{total:queries.length,avgResults:avgRes,avgDuration:avgDur,topQueries:Object.entries(qc).map(([q,c])=>({query:q,count:c})).sort((a,b)=>b.count-a.count).slice(0,10)}; }
export interface SearchFilter { field:string; value:string; usageCount:number; }
export function recommendFilters(filters:SearchFilter[]): SearchFilter[] { return filters.filter(f=>f.usageCount>=5).sort((a,b)=>b.usageCount-a.usageCount); }
export interface SavedQuery { id:string; name:string; query:string; filters:Record<string,any>; recordType:string; createdBy:string; }
export function executeSavedQuery(query:SavedQuery,records:Record<string,any>[]): Record<string,any>[] { return records.filter(r=>Object.entries(query.filters).every(([k,v])=>String(r[k]||'').toLowerCase().includes(String(v).toLowerCase()))); }
export interface SearchIndex { recordType:string; indexedFields:string[]; lastIndexed:string; documentCount:number; }
export function checkIndexHealth(indexes:SearchIndex[]): {totalDocuments:number;staleIndexes:SearchIndex[]} { const now=Date.now(); return{totalDocuments:indexes.reduce((s,i)=>s+i.documentCount,0),staleIndexes:indexes.filter(i=>now-new Date(i.lastIndexed).getTime()>86400000)}; }
export interface SearchSuggestion { query:string; suggestion:string; correctionType:'spelling'|'synonym'|'expansion'; }
export function suggestCorrections(query:string,commonMisspellings:Record<string,string>): string { return commonMisspellings[query.toLowerCase()]||query; }
export interface SearchFacet { field:string; values:Array<{value:string;count:number}>; }
export function generateFacets(records:Record<string,any>[],field:string): SearchFacet { const counts:Record<string,number>={};for(const r of records){const v=String(r[field]||'Unknown');counts[v]=(counts[v]||0)+1;} return{field,values:Object.entries(counts).map(([v,c])=>({value:v,count:c})).sort((a,b)=>b.count-a.count)}; }
export interface SearchRelevance { query:string; resultId:string; score:number; matchFields:string[]; }
export function scoreSearchRelevance(query:string,record:Record<string,any>,searchableFields:string[]): number { let score=0; const q=query.toLowerCase(); for(const f of searchableFields){const v=String(record[f]||'').toLowerCase(); if(v===q)score+=100; else if(v.startsWith(q))score+=50; else if(v.includes(q))score+=25;} return score; }
export interface FullTextIndex { recordType:string; field:string; tokens:string[]; }
export function tokenizeText(text:string): string[] { return text.toLowerCase().split(/[\s,.;:!?()\[\]{}"']+/).filter(t=>t.length>1); }
export interface SearchCache { queryHash:string; results:string[]; cachedAt:string; ttlSeconds:number; }
export function checkCacheValidity(cache:SearchCache): boolean { return (Date.now()-new Date(cache.cachedAt).getTime())/1000<cache.ttlSeconds; }
export interface SearchDashboard { totalQueries:number; uniqueUsers:number; avgResultsPerQuery:number; zeroResultRate:number; topSearchTerms:Array<{term:string;count:number}>; }
export function compileSearchDashboard(queries:SearchQuery[]): SearchDashboard { const users=new Set(queries.map(q=>q.userId)).size; const zeroResults=queries.filter(q=>q.resultsCount===0).length; return{totalQueries:queries.length,uniqueUsers:users,avgResultsPerQuery:0,zeroResultRate:queries.length>0?Math.round(zeroResults/queries.length*100):0,topSearchTerms:[]}; }
