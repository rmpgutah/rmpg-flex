// ============================================================
// RMPG Flex — Integration Library Index
// ============================================================
// Centralized exports for all third-party integrations.
// Import from '@/integrations' or '../integrations' rather
// than individual files for cleaner imports.
// ============================================================

// Geospatial
export * from './turfGeo';

// Visualization
export { mountChart, crimeByBeatChart, incidentTrendChart, crimeHeatmapChart, responseTimeChart, citationBreakdownChart } from './observablePlot';
export { createTimeline, incidentTimelineGroups, custodyTimelineGroups } from './visTimeline';
export { createNetworkGraph } from './networkGraph';

// Maps
export { createHeatmapLayer, createIncidentLayer, createUnitLayer, createDispatchArcLayer, initDeckOverlay, updateDeckLayers, destroyDeckOverlay } from './deckLayers';

// Collaboration
export { createCollaborativeDoc, createIncidentSession, mergeDocuments } from './collaboration';
export { createVersionedDoc, loadVersionedDoc, createVersionedIncident, createVersionedCaseFile } from './documentHistory';

// AI & Document Processing
export { recognizeText, recognizeBatch, extractText, assessImageQuality } from './ocrEngine';

// Communication
export { initPeer, connectToPeer, sendData, callPeer, answerCall, sendFile, getPeerStatus, destroyPeer } from './peerConnection';

// Audit
export { startRecording, stopRecording, getRecordingStatus, flushEvents, buildSessionRecording } from './sessionRecording';

// Rich Text
export { RichTextEditor, htmlToPlainText } from './richTextEditor';

// Tactical
export { TacticalWhiteboard, createTacticalTemplate, createCrimeSceneTemplate, exportWhiteboardAsPng } from './tacticalWhiteboard';
