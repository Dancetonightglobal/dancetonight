import { describe, expect, it } from "vitest";
import { matchStyles } from "@/config/styles";

// Wave-1 city vocabulary (D-235): real titles sent by the Barcelona, Lisbon, Rio, Buenos Aires,
// Mexico City and San Juan chats on 2026-10-29.
const stylesOf = (title: string) => matchStyles(title).styles;

describe("wave-1 city style words (D-235)", () => {
  it.each([
    ["Gran Baile de Danzón en el Zócalo", "danzon"],
    ["Tarde de Danzón", "danzon"],
    ["Megabaile Sonidero", "cumbia"],
    ["Gran Baile de Sonideros", "cumbia"],
    ["Miércoles de Salsa para el Bailador", "salsa"],
    ["Somos Casineros en México", "salsa"],
    ["Bombazo in San Juan", "bomba"],
    ["Plenazo en la plaza", "plena"],
    ["Forrozin na Lapa", "forro"],
    ["Forró pé de serra", "forro"],
    ["Ensaio da Escola de Samba", "samba_no_pe"],
    ["Baile Funk na Rocinha", "baile_funk"],
    ["Noite Sertaneja", "sertanejo"],
    ["Festa Junina do Bairro", "quadrilha"],
    ["Ballada de sardanes", "sardana"],
    ["Ball de saló al casal", "social_ballroom"],
    ["Ball en línia", "line_dance"],
    ["Peña folklórica en San Telmo", "argentine_folklore"],
    ["El Despelote Milonga Queer", "milonga"],
  ])("%s -> %s", (title, style) => {
    expect(stylesOf(title)).toContain(style);
  });

  it("bomba y plena is both", () => {
    expect(stylesOf("Bomba y plena en el Viejo San Juan")).toEqual(
      expect.arrayContaining(["bomba", "plena"]),
    );
    expect(stylesOf("Bomplenazo")).toEqual(expect.arrayContaining(["bomba", "plena"]));
  });

  it.each([
    "Fiesta bomba en el Condado",
    "en plena noche",
    "Casino night",
    "Sonido La Changa",
    "Peña del barrio",
  ])("%s names no wave-1 style", (title) => {
    for (const style of ["bomba", "plena", "rueda", "salsa", "cumbia", "argentine_folklore"]) {
      expect(stylesOf(title)).not.toContain(style);
    }
  });
});
