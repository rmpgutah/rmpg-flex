import type { RawWarrantHit, PersonRow } from './types';
import { identityConfirmed, type IdentityFields } from '../identityConfirm';

function hitFields(hit: RawWarrantHit): IdentityFields {
  return {
    first: hit.first_name,
    last: hit.last_name,
    fullName: hit.full_name,
    dob: hit.date_of_birth,
    age: hit.age,
    city: hit.city,
    state: hit.state,
  };
}

function personFields(person: PersonRow): IdentityFields {
  return {
    first: person.first_name,
    last: person.last_name,
    dob: person.dob,
  };
}

/**
 * Positive identity confirmation gate for linking a per-person-source hit
 * to a local person record. Name AND DOB/age are required — a namesake
 * without matching birthday/age is never attached. See identityConfirm.ts.
 */
export function identityMatch(hit: RawWarrantHit, person: PersonRow): boolean {
  return identityConfirmed(personFields(person), hitFields(hit));
}
