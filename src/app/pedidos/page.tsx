"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Package,
  AlertTriangle,
  CheckCircle2,
  Truck,
  RefreshCw,
  Search,
  ExternalLink,
  Filter,
  MessageCircle,
  ArrowLeft,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";

interface Registro {
  fecha: string;
  quien: string;
  asunto: string;
  enlace: string;
  cuerpo: string;
  estado: string;
  tipo: string;
  prioridad: string;
  autoDropdown: string;
  respuestaAuto: string;
  telefono: string;
}

interface RegistroConIdx extends Registro {
  _idx: number;
}

function limpiarNombre(raw: string): string {
  if (!raw) return "—";
  return (
    raw
      .replace(/^""+|""+$/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/"/g, "")
      .trim() || "—"
  );
}

function parseFecha(fecha: string): Date | null {
  if (!fecha) return null;
  const parts = fecha.split(" ")[0].split("/");
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(fecha);
}

function formatFecha(fecha: string): string {
  if (!fecha) return "—";
  const d = parseFecha(fecha);
  if (!d || isNaN(d.getTime())) return fecha;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getWhatsAppLink(
  telefono: string,
  nombre: string,
  asunto: string,
  estado: string
) {
  if (!telefono) return "#";
  const cleanPhone = telefono.replace(/\D/g, "");
  if (!cleanPhone) return "#";

  const msgNombre = limpiarNombre(nombre).split(" ")[0];
  const cleanAsunto = asunto.replace(/^"+|"+$/g, "").trim();
  const esEnvio = estado.toLowerCase().includes("enviado");

  const mensaje = esEnvio
    ? `Hola ${msgNombre}, le informamos desde *Abad Pinturas* que su pedido "${cleanAsunto}" ya ha sido enviado. ¡Gracias por confiar en nosotros! 🚚`
    : `Hola ${msgNombre}, le contactamos desde *Abad Pinturas* en relación a su pedido "${cleanAsunto}". ¿Podríamos hablar?`;

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`;
}

const ESTADO_OPTIONS = [
  {
    value: "PENDIENTE (Pedido)",
    label: "Pendiente",
    color: "bg-yellow-100 text-yellow-800 border-yellow-200",
  },
  {
    value: "En Curso",
    label: "En Curso",
    color: "bg-blue-100 text-blue-800 border-blue-200",
  },
  {
    value: "Enviado",
    label: "Enviado",
    color: "bg-green-100 text-green-800 border-green-200",
  },
];

function getEstadoColor(estado: string): string {
  const match = ESTADO_OPTIONS.find(
    (o) => o.value.toLowerCase() === estado.toLowerCase()
  );
  return match?.color ?? "bg-gray-100 text-gray-700 border-gray-200";
}

export default function PedidosPage() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroPrioridad, setFiltroPrioridad] = useState("todos");
  const [saving, setSaving] = useState<string | null>(null);

  const updateCell = useCallback(
    async (rowIndex: number, columna: number, valor: string) => {
      const registroActual = registros[rowIndex];
      const fila = rowIndex + 2;
      const key = `${fila}-${columna}`;
      setSaving(key);
      try {
        const res = await fetch("/api/sheets/update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fila,
            columna,
            valor,
            telefono: registroActual.telefono,
            quien: registroActual.quien,
            asunto: registroActual.asunto,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          setRegistros((prev) =>
            prev.map((r, i) => {
              if (i !== rowIndex) return r;
              if (columna === 6) return { ...r, estado: valor };
              if (columna === 8) return { ...r, prioridad: valor };
              if (columna === 11) return { ...r, telefono: valor };
              return r;
            })
          );
        } else {
          alert("Error al guardar: " + (data.error || "desconocido"));
        }
      } catch {
        alert("Error de conexion al guardar");
      } finally {
        setSaving(null);
      }
    },
    [registros]
  );

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sheets");
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      setRegistros(json.registros ?? []);
    } catch {
      setError("No se pudo conectar con la API");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const pedidos = useMemo(
    () =>
      registros
        .map((r, idx) => ({ ...r, _idx: idx }))
        .filter((r) => r.tipo.toLowerCase().includes("pedido")),
    [registros]
  );

  const stats = useMemo(() => {
    const pendientes = pedidos.filter((r) =>
      r.estado.toLowerCase().includes("pendiente")
    );
    const enCurso = pedidos.filter((r) =>
      r.estado.toLowerCase().includes("en curso")
    );
    const enviados = pedidos.filter(
      (r) => r.estado.toLowerCase() === "enviado"
    );
    const urgentes = pedidos.filter((r) =>
      r.prioridad.toLowerCase().includes("urgente")
    );
    return { pendientes, enCurso, enviados, urgentes };
  }, [pedidos]);

  const filtrados: RegistroConIdx[] = useMemo(() => {
    return pedidos.filter((r) => {
      const matchSearch =
        search === "" ||
        r.quien.toLowerCase().includes(search.toLowerCase()) ||
        r.asunto.toLowerCase().includes(search.toLowerCase());
      const matchEstado =
        filtroEstado === "todos" ||
        r.estado.toLowerCase().includes(filtroEstado.toLowerCase());
      const matchPrioridad =
        filtroPrioridad === "todos" ||
        (filtroPrioridad === "normal" &&
          !r.prioridad.toLowerCase().includes("urgente") &&
          !r.prioridad.toLowerCase().includes("recogida")) ||
        r.prioridad.toLowerCase().includes(filtroPrioridad.toLowerCase());
      return matchSearch && matchEstado && matchPrioridad;
    });
  }, [pedidos, search, filtroEstado, filtroPrioridad]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400 mx-auto" />
          <p className="text-gray-500">Cargando pedidos...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
            <h2 className="text-lg font-semibold">Error de conexion</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:opacity-90"
            >
              Reintentar
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-orange-500 flex items-center justify-center">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">AP Coatings</h1>
              <p className="text-xs text-muted-foreground">
                Pedidos — {pedidos.length} total
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Actualizar</span>
            </button>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-gray-50 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard
            title="Total pedidos"
            value={pedidos.length}
            icon={<Package className="h-5 w-5" />}
            color="text-orange-600"
            bg="bg-orange-50"
          />
          <KPICard
            title="Pendientes"
            value={stats.pendientes.length}
            icon={<Clock className="h-5 w-5" />}
            color="text-yellow-600"
            bg="bg-yellow-50"
          />
          <KPICard
            title="En Curso"
            value={stats.enCurso.length}
            icon={<Truck className="h-5 w-5" />}
            color="text-blue-600"
            bg="bg-blue-50"
          />
          <KPICard
            title="Enviados"
            value={stats.enviados.length}
            icon={<CheckCircle2 className="h-5 w-5" />}
            color="text-green-600"
            bg="bg-green-50"
          />
        </div>

        {/* Urgentes alert */}
        {stats.urgentes.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-red-200 bg-red-50">
            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-700 font-medium">
              {stats.urgentes.length} pedido{stats.urgentes.length > 1 ? "s" : ""} marcado{stats.urgentes.length > 1 ? "s" : ""} como urgente
            </p>
            <button
              onClick={() => setFiltroPrioridad("urgente")}
              className="ml-auto text-xs text-red-600 underline hover:no-underline"
            >
              Ver solo urgentes
            </button>
          </div>
        )}

        {/* Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <CardTitle className="text-base">
                Listado de pedidos
                {filtrados.length !== pedidos.length && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({filtrados.length} de {pedidos.length})
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar cliente o asunto..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-9 w-[220px] text-sm"
                  />
                </div>
                <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                  <SelectTrigger className="h-9 w-[150px] text-sm">
                    <Filter className="h-3.5 w-3.5 mr-1" />
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los estados</SelectItem>
                    <SelectItem value="pendiente">Pendiente</SelectItem>
                    <SelectItem value="en curso">En Curso</SelectItem>
                    <SelectItem value="enviado">Enviado</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={filtroPrioridad}
                  onValueChange={setFiltroPrioridad}
                >
                  <SelectTrigger className="h-9 w-[140px] text-sm">
                    <SelectValue placeholder="Prioridad" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Toda prioridad</SelectItem>
                    <SelectItem value="urgente">Urgente</SelectItem>
                    <SelectItem value="recogida">Recogida</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-gray-50/50">
                    <TableHead className="w-[100px]">Fecha</TableHead>
                    <TableHead className="w-[180px]">Cliente</TableHead>
                    <TableHead>Asunto</TableHead>
                    <TableHead className="w-[160px]">Contacto / WA</TableHead>
                    <TableHead className="w-[148px]">Estado</TableHead>
                    <TableHead className="w-[110px]">Prioridad</TableHead>
                    <TableHead className="w-[60px]">Docs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No hay pedidos con estos filtros
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtrados.map((r, i) => {
                      const enlaces = r.enlace
                        ? r.enlace
                            .split(",")
                            .map((e) => e.trim())
                            .filter(Boolean)
                        : [];
                      const savingEstado = saving === `${r._idx + 2}-6`;
                      const savingPrioridad = saving === `${r._idx + 2}-8`;
                      const savingTelefono = saving === `${r._idx + 2}-11`;

                      return (
                        <TableRow key={i} className="hover:bg-orange-50/30">
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatFecha(r.fecha)}
                          </TableCell>
                          <TableCell
                            className="font-medium text-sm max-w-[180px] truncate"
                            title={r.quien}
                          >
                            {limpiarNombre(r.quien)}
                          </TableCell>
                          <TableCell
                            className="text-sm max-w-[250px] truncate"
                            title={r.asunto}
                          >
                            {r.asunto.replace(/^"+|"+$/g, "")}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 min-w-[140px]">
                              <div className="relative w-full">
                                <input
                                  type="text"
                                  placeholder="Teléfono..."
                                  value={r.telefono || ""}
                                  disabled={savingTelefono}
                                  onChange={(e) => {
                                    const val = e.target.value.replace(
                                      /[^\d+ \-]/g,
                                      ""
                                    );
                                    setRegistros((prev) =>
                                      prev.map((item, idx) =>
                                        idx === r._idx
                                          ? { ...item, telefono: val }
                                          : item
                                      )
                                    );
                                  }}
                                  onBlur={(e) =>
                                    updateCell(r._idx, 11, e.target.value)
                                  }
                                  className={`w-full text-xs p-1.5 border rounded focus:ring-1 focus:ring-orange-500 outline-none pr-6 ${
                                    savingTelefono ? "opacity-50" : ""
                                  } ${
                                    r.estado?.toLowerCase() === "enviado" &&
                                    !r.telefono
                                      ? "border-red-300 bg-red-50"
                                      : "border-gray-200"
                                  }`}
                                />
                                {savingTelefono && (
                                  <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
                                    <RefreshCw className="h-2.5 w-2.5 animate-spin text-gray-400" />
                                  </div>
                                )}
                              </div>
                              {r.telefono && (
                                <a
                                  href={getWhatsAppLink(
                                    r.telefono,
                                    r.quien,
                                    r.asunto,
                                    r.estado
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`shrink-0 p-2 rounded-md text-white transition-all shadow-sm hover:scale-105 active:scale-95 ${
                                    r.estado?.toLowerCase() === "enviado"
                                      ? "bg-green-600 hover:bg-green-700"
                                      : "bg-gray-400 hover:bg-gray-500"
                                  }`}
                                  title="Abrir WhatsApp Web"
                                >
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <select
                              value={
                                ESTADO_OPTIONS.find(
                                  (o) =>
                                    o.value.toLowerCase() ===
                                    r.estado.toLowerCase()
                                )?.value ?? r.estado
                              }
                              disabled={savingEstado}
                              onChange={(e) =>
                                updateCell(r._idx, 6, e.target.value)
                              }
                              className={`text-xs font-medium rounded-md px-2 py-1.5 border cursor-pointer outline-none transition-colors w-full ${
                                savingEstado ? "opacity-50" : ""
                              } ${getEstadoColor(r.estado)}`}
                            >
                              {!ESTADO_OPTIONS.find(
                                (o) =>
                                  o.value.toLowerCase() ===
                                  r.estado.toLowerCase()
                              ) && (
                                <option value={r.estado}>
                                  {r.estado || "Sin estado"}
                                </option>
                              )}
                              {ESTADO_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell>
                            <select
                              value={r.prioridad || ""}
                              disabled={savingPrioridad}
                              onChange={(e) =>
                                updateCell(r._idx, 8, e.target.value)
                              }
                              className={`text-xs font-medium rounded-md px-2 py-1.5 border cursor-pointer outline-none transition-colors ${
                                savingPrioridad ? "opacity-50" : ""
                              } ${
                                r.prioridad?.toLowerCase().includes("urgente")
                                  ? "bg-red-100 text-red-700 border-red-200"
                                  : r.prioridad
                                        ?.toLowerCase()
                                        .includes("recogida")
                                    ? "bg-blue-100 text-blue-700 border-blue-200"
                                    : "bg-gray-50 text-gray-600 border-gray-200"
                              }`}
                            >
                              <option value="">Normal</option>
                              <option value="urgente">Urgente</option>
                              <option value="recogida">Recogida</option>
                            </select>
                          </TableCell>
                          <TableCell>
                            {enlaces.length > 0 ? (
                              <a
                                href={enlaces[0]}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {enlaces.length > 1
                                  ? `${enlaces.length}`
                                  : "Ver"}
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Progress summary */}
        {pedidos.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-orange-500" />
                Progreso general
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  label: "Pendientes",
                  count: stats.pendientes.length,
                  color: "bg-yellow-400",
                  textColor: "text-yellow-700",
                },
                {
                  label: "En Curso",
                  count: stats.enCurso.length,
                  color: "bg-blue-400",
                  textColor: "text-blue-700",
                },
                {
                  label: "Enviados",
                  count: stats.enviados.length,
                  color: "bg-green-400",
                  textColor: "text-green-700",
                },
              ].map((etapa) => {
                const pct =
                  pedidos.length > 0
                    ? Math.round((etapa.count / pedidos.length) * 100)
                    : 0;
                return (
                  <div key={etapa.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{etapa.label}</span>
                      <span className={`text-sm font-bold ${etapa.textColor}`}>
                        {etapa.count}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${etapa.color} transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {pct}% del total
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}

function KPICard({
  title,
  value,
  icon,
  color,
  bg,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className={`${bg} p-2.5 rounded-lg ${color}`}>{icon}</div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{title}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
