// ============================================================
// Skip Tracker 3.5 — Source Registry
// ============================================================
// Central registry of all data source adapters. Each source
// is instantiated once and shared across all searches.

import type { DataSource } from '../types';

// --- Import source adapters ---
import RapidApiSource from './rapidapi';
import LocalDbSource from './localDb';
import OfacSource from './ofac';
import ArrestsSource from './arrests';
import MicrobiltSource from './microbilt';
import CourtListenerSource from './courtListener';
import FbiWantedSource from './fbiWanted';
import FccUlsSource from './fccUls';
import OpenCorporatesSource from './openCorporates';
import UtahCourtsSource from './utahCourts';
import SlcAssessorSource from './slcAssessor';
import NsopwSource from './nsopw';
import UtahBusinessSource from './utahBusiness';
import UtahDoplSource from './utahDOPL';
import UsernameSearchSource from './usernameSearch';
import UsMarshalsSource from './usMarshals';
import DeaFugitivesSource from './deaFugitives';
import UtahVoterRecordsSource from './utahVoterRecords';
import PacerLookupSource from './pacerLookup';
import UccFilingsSource from './uccFilings';
import SocialBladeSource from './socialBlade';

/** Lazy-initialized sources (avoids calling getDb() before initDatabase()) */
let sources: DataSource[] | null = null;

function ensureSources(): DataSource[] {
  if (!sources) {
    sources = [
      new RapidApiSource(),
      new LocalDbSource(),
      new OfacSource(),
      new ArrestsSource(),
      new MicrobiltSource(),
      new CourtListenerSource(),
      new FbiWantedSource(),
      new FccUlsSource(),
      new OpenCorporatesSource(),
      new UtahCourtsSource(),
      new SlcAssessorSource(),
      new NsopwSource(),
      new UtahBusinessSource(),
      new UtahDoplSource(),
      new UsernameSearchSource(),
      new UsMarshalsSource(),
      new DeaFugitivesSource(),
      new UtahVoterRecordsSource(),
      new PacerLookupSource(),
      new UccFilingsSource(),
      new SocialBladeSource(),
    ];
  }
  return sources;
}

/** Return every registered source (enabled or not). */
export function getAllSources(): DataSource[] {
  return ensureSources();
}

/** Return only sources that are both enabled and configured. */
export function getEnabledSources(): DataSource[] {
  return ensureSources().filter(s => s.isEnabled() && s.isConfigured());
}

/** Find a source by its unique name identifier. */
export function getSourceByName(name: string): DataSource | undefined {
  return ensureSources().find(s => s.name === name);
}
