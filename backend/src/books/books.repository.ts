import { db } from "../../db/connection.ts";
export interface Book {
  code: string;
  name: string;
}
export const selectBooks = async (): Promise<Book[]> =>
  (await db.query<Book>("SELECT code, name FROM books ORDER BY code")).rows;
export const selectBookByCode = async (code: string): Promise<Book | null> =>
  (await db.query<Book>("SELECT code, name FROM books WHERE code = $1", [code])).rows[0] ?? null;
