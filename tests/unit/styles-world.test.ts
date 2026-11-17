import { describe, expect, it } from "vitest";
import { matchStyles } from "@/config/styles";

const stylesOf = (title: string) => matchStyles(title).styles;

describe("world styles (D-559 fix 3)", () => {
  it.each([
    ["Noite de Funaná", "funana"],
    ["Batuku na Mouraria", "batuque"],
    ["Morna e Coladeira ao vivo", "coladeira"],
    ["Zouk Love Night", "zouk_love"],
    ["Raboday Party", "raboday"],
    ["Coupé-Décalé Night", "coupe_decale"],
    ["Rumba Cubana en el patio", "guaguanco"],
    ["Noche Vallenata", "vallenato"],
    ["Noche de Boleros", "bolero"],
    ["DC Hand Dancing Social", "hand_dancing"],
    ["Soul Line Dancing Tuesdays", "soul_line"],
    ["Clogging Class", "clogging"],
    ["Rancho Folclórico de Lisboa", "portuguese_folk"],
    ["Kola San Jon na Cova da Moura", "kola_san_jon"],
    ["Ball de bot a la plaça", "catalan_folk"],
    ["Baile Jíbaro", "puerto_rican_folk"],
    ["Joropo llanero", "joropo"],
    ["Roda de Jongo", "brazilian_folk"],
    ["Lavani Night", "marathi_folk"],
    ["Ukrainian Zabava", "ukrainian_folk"],
    ["Highland Dancing for adults", "scottish_highland"],
    ["Khaleeji dance class", "khaleeji"],
    ["Baile Charme do Viaduto", "charme"],
    ["Passinho no Morro", "passinho"],
    ["Kathak workshop", "indian_classical"],
    ["Roda de Capoeira", "capoeira"],
    ["Second Line Sunday", "second_line"],
    ["Chicago Steppin' Night", "steppin"],
    ["Sabar Night", "sabar"],
    // Words added to existing keys
    ["Tarrachinha Night", "tarraxinha"],
    ["Forró Pé de Serra na Lapa", "forro"],
    ["Arraial Junino", "quadrilha"],
    ["Govend gecesi", "turkish_folk"],
    ["Greek Glendi", "greek"],
    ["Sirtaki Night", "greek"],
    ["Bembé en la calle", "bomba"],
    ["Cubatón Party", "reggaeton"],
    ["Perico Ripiao en vivo", "merengue"],
    ["Filmi Night", "bollywood"],
    ["Sangeet Night", "bollywood"],
    ["Balkan Brass Party", "balkan"],
    ["Noche de Chamamé", "argentine_folklore"],
    ["Chá Dançante", "social_ballroom"],
    ["Almoço Dançante", "social_ballroom"],
  ])("%s -> %s", (title, key) => {
    expect(stylesOf(title)).toContain(key);
  });

  it.each([
    ["Agua morna", "coladeira"],
    ["Charme Boutique sale", "charme"],
    ["Two stepping lessons", "steppin"],
  ])("%s does NOT match %s", (title, key) => {
    expect(stylesOf(title)).not.toContain(key);
  });
});
