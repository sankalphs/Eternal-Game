// ============================================================================
// DIRECTOR BRIDGE
//
// Glue between the existing Director system and the evolved GenomeLibrary.
// The Director calls selectGenome() and receives a frozen ILibraryEntry ready
// to be loaded into the GameEngine. No runtime evolution occurs.
// ============================================================================

import type { IGenomeLibrary, IGenomeSelectionInput, ILibraryEntry } from "./types";
import { GenomeDirector } from "./GenomeDirector";

export interface IDirectorBridge {
  selectGenome(input: IGenomeSelectionInput): ILibraryEntry;
  getLibrary(): IGenomeLibrary;
}

export function createDirectorBridge(library: IGenomeLibrary): IDirectorBridge {
  const director = new GenomeDirector(library);
  return {
    selectGenome: (input) => director.selectGenome(input),
    getLibrary: () => director.getLibrary(),
  };
}
