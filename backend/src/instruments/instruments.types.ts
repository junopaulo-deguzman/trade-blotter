export interface Instrument {
  id: number;
  symbol: string;
  name: string;
}
export type InstrumentResponse = Pick<Instrument, "symbol" | "name">;
