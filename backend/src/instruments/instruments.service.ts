import { selectInstruments, selectInstrumentBySymbol } from "./instruments.repository.ts";
import type { InstrumentResponse } from "./instruments.types.ts";

export const getInstruments = async (): Promise<InstrumentResponse[]> =>
  (await selectInstruments()).map(({ symbol, name }) => ({ symbol, name }));

export const getInstrumentBySymbol = selectInstrumentBySymbol;
