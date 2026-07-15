// Normaliza un texto de período a "YYYY-MM" cuando es posible, para comparar si dos extractos son del mismo mes.
export const normalizePeriod = (period: string): string => {
  if (!period) return "";
  const s = String(period).toLowerCase().trim();
  const ym = s.match(/(20\d{2})[-/\s.](0?[1-9]|1[0-2])/);
  if (ym) return `${ym[1]}-${ym[2].padStart(2, "0")}`;
  const my = s.match(/(0?[1-9]|1[0-2])[-/\s.](20\d{2})/);
  if (my) return `${my[2]}-${my[1].padStart(2, "0")}`;
  const months: Record<string, string> = {
    enero: "01", ene: "01", january: "01", jan: "01",
    febrero: "02", feb: "02", february: "02",
    marzo: "03", mar: "03", march: "03",
    abril: "04", abr: "04", april: "04", apr: "04",
    mayo: "05", may: "05",
    junio: "06", jun: "06", june: "06",
    julio: "07", jul: "07", july: "07",
    agosto: "08", ago: "08", aug: "08", august: "08",
    septiembre: "09", sep: "09", sept: "09", september: "09",
    octubre: "10", oct: "10", october: "10",
    noviembre: "11", nov: "11", november: "11",
    diciembre: "12", dic: "12", dec: "12", december: "12",
  };
  for (const [name, num] of Object.entries(months)) {
    const re = new RegExp(`${name}[^0-9]*(20\\d{2})`);
    const m = s.match(re);
    if (m) return `${m[1]}-${num}`;
  }
  return s;
};
