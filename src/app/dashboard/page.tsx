"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  Package,
  FileText,
  MessageSquare,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Truck,
  RefreshCw,
  Search,
  ExternalLink,
  Filter,
  MessageCircle,
  ShoppingCart,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

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

function limpiarNombre(raw: string): string {
  if (!raw) return "—";
  return raw
    .replace(/^""+|""+$/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/"/g, "")
    .trim() || "—";
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

function getWhatsAppLink(telefono: string, nombre: string, asunto: string, tipo: string, estado: string) {
  if (!telefono) return "#";
  const cleanPhone = telefono.replace(/\D/g, "");
  if (!cleanPhone) return "#";
  
  const msgNombre = limpiarNombre(nombre).split(" ")[0]; // Solo el primer nombre
  const cleanAsunto = asunto.replace(/^"+|"+$/g, "").trim();
  const esEnvio = estado.toLowerCase().includes("enviado");
  const esFactura = tipo.toLowerCase().includes("factura") || estado.toLowerCase().includes("factura");
  
  let mensaje = "";
  if (esEnvio) {
    mensaje = `Hola ${msgNombre}, le informamos desde *Abad Pinturas* que su pedido "${cleanAsunto}" ya ha sido enviado. ¡Gracias por confiar en nosotros! 🚚`;
  } else if (esFactura) {
    mensaje = `Hola ${msgNombre}, le informamos desde *Abad Pinturas* que su factura "${cleanAsunto}" ya está disponible para su gestión. Atentamente.`;
  } else {
    mensaje = `Hola ${msgNombre}, le contactamos desde *Abad Pinturas* en relación a su gestión de "${cleanAsunto}". ¿Podríamos hablar?`;
  }
  
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`;
}

const TIPO_CONFIG: Record<string, { color: string; icon: React.ReactNode }> = {
  "Pedido": { color: "bg-orange-100 text-orange-700 border-orange-200", icon: <Package className="h-3 w-3" /> },
  "Factura": { color: "bg-violet-100 text-violet-700 border-violet-200", icon: <FileText className="h-3 w-3" /> },
  "Consulta": { color: "bg-cyan-100 text-cyan-700 border-cyan-200", icon: <MessageSquare className="h-3 w-3" /> },
};

const PIE_COLORS = ["#f97316", "#8b5cf6", "#06b6d4", "#ef4444", "#10b981"];

export default function DashboardPage() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [activeTab, setActiveTab] = useState("todo");
  const [saving, setSaving] = useState<string | null>(null);

  const updateCell = useCallback(async (
    rowIndex: number,
    columna: number,
    valor: string
  ) => {
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
  }, []);

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

  const filtrados = useMemo(() => {
    return registros
      .map((r, idx) => ({ ...r, _idx: idx }))
      .filter((r) => {
        const matchSearch =
          search === "" ||
          r.quien.toLowerCase().includes(search.toLowerCase()) ||
          r.asunto.toLowerCase().includes(search.toLowerCase());
        const matchEstado =
          filtroEstado === "todos" ||
          r.estado.toLowerCase().includes(filtroEstado.toLowerCase());
        const matchTipo =
          filtroTipo === "todos" ||
          r.tipo.toLowerCase().includes(filtroTipo.toLowerCase());

        if (activeTab === "pedidos") return matchSearch && matchEstado && r.tipo.toLowerCase().includes("pedido");
        if (activeTab === "facturas") return matchSearch && matchEstado && (r.tipo.toLowerCase().includes("factura") || r.estado.toLowerCase().includes("factura"));
        if (activeTab === "consultas") return matchSearch && matchEstado && r.tipo.toLowerCase().includes("consulta");
        return matchSearch && matchEstado && matchTipo;
      });
  }, [registros, search, filtroEstado, filtroTipo, activeTab]);

  // KPIs
  const stats = useMemo(() => {
    const pedidos = registros.filter((r) => r.tipo.toLowerCase().includes("pedido"));
    const facturas = registros.filter((r) => r.tipo.toLowerCase().includes("factura") || r.estado.toLowerCase().includes("factura"));
    const consultas = registros.filter((r) => r.tipo.toLowerCase().includes("consulta"));
    const urgentes = registros.filter((r) => r.prioridad.toLowerCase().includes("urgente"));
    const enCurso = registros.filter((r) => r.estado.toLowerCase().includes("en curso"));
    const enviados = registros.filter((r) => r.estado.toLowerCase() === "enviado");

    return { pedidos, facturas, consultas, urgentes, enCurso, enviados };
  }, [registros]);

  // Chart data
  const tipoChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    registros.forEach((r) => {
      const tipo = r.tipo || r.estado.split(" ").pop() || "Otro";
      counts[tipo] = (counts[tipo] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [registros]);

  const estadoChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    registros.forEach((r) => {
      const estado = r.estado || "Sin estado";
      counts[estado] = (counts[estado] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [registros]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-4">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400 mx-auto" />
          <p className="text-gray-500">Cargando datos de la hoja de calculo...</p>
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
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-orange-500 flex items-center justify-center">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">AP Coatings</h1>
              <p className="text-xs text-muted-foreground">Panel de control - Pedidos y Facturas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
              <Link
                href="/pedidos"
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-orange-500 text-white hover:bg-orange-600 transition-colors font-medium"
              >
                <ShoppingCart className="h-4 w-4" />
                Pedidos
              </Link>
              <button
                onClick={fetchData}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Actualizar
              </button>
            </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard title="Pedidos" value={stats.pedidos.length} icon={<Package className="h-5 w-5" />} color="text-orange-600" bg="bg-orange-50" />
          <KPICard title="Facturas Prov." value={stats.facturas.length} icon={<FileText className="h-5 w-5" />} color="text-violet-600" bg="bg-violet-50" />
          <KPICard title="Consultas" value={stats.consultas.length} icon={<MessageSquare className="h-5 w-5" />} color="text-cyan-600" bg="bg-cyan-50" />
          <KPICard title="Urgentes" value={stats.urgentes.length} icon={<AlertTriangle className="h-5 w-5" />} color="text-red-600" bg="bg-red-50" />
          <KPICard title="En Curso" value={stats.enCurso.length} icon={<Truck className="h-5 w-5" />} color="text-blue-600" bg="bg-blue-50" />
          <KPICard title="Enviados" value={stats.enviados.length} icon={<CheckCircle2 className="h-5 w-5" />} color="text-green-600" bg="bg-green-50" />
        </div>

        {/* Charts */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Por tipo</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={tipoChartData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                      {tipoChartData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Por estado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={estadoChartData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#f97316" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters + Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <CardTitle className="text-base">Registro de actividad</CardTitle>
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
                  <SelectTrigger className="h-9 w-[140px] text-sm">
                    <Filter className="h-3.5 w-3.5 mr-1" />
                    <SelectValue placeholder="Estado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los estados</SelectItem>
                    <SelectItem value="enviado">Enviado</SelectItem>
                    <SelectItem value="en curso">En Curso</SelectItem>
                    <SelectItem value="factura">Factura Prov.</SelectItem>
                    <SelectItem value="pendiente">Pendiente</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filtroTipo} onValueChange={setFiltroTipo}>
                  <SelectTrigger className="h-9 w-[130px] text-sm">
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los tipos</SelectItem>
                    <SelectItem value="pedido">Pedido</SelectItem>
                    <SelectItem value="factura">Factura</SelectItem>
                    <SelectItem value="consulta">Consulta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="px-6">
              <TabsList className="grid w-full max-w-md grid-cols-4">
                <TabsTrigger value="todo">Todo ({registros.length})</TabsTrigger>
                <TabsTrigger value="pedidos">Pedidos ({stats.pedidos.length})</TabsTrigger>
                <TabsTrigger value="facturas">Facturas ({stats.facturas.length})</TabsTrigger>
                <TabsTrigger value="consultas">Consultas ({stats.consultas.length})</TabsTrigger>
              </TabsList>
            </div>

            {["todo", "pedidos", "facturas", "consultas"].map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-gray-50/50">
                          <TableHead className="w-[100px]">Fecha</TableHead>
                              <TableHead className="w-[180px]">Remitente</TableHead>
                              <TableHead>Asunto</TableHead>
                              <TableHead className="w-[160px]">Contacto / WA</TableHead>
                              <TableHead className="w-[120px]">Estado</TableHead>
                          <TableHead className="w-[100px]">Tipo</TableHead>
                          <TableHead className="w-[100px]">Prioridad</TableHead>
                          <TableHead className="w-[60px]">Docs</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                          {filtrados.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                No hay registros
                              </TableCell>
                            </TableRow>
                          ) : (
                            filtrados.map((r, i) => {
                              const tipoCfg = Object.entries(TIPO_CONFIG).find(([k]) =>
                                r.tipo.toLowerCase().includes(k.toLowerCase())
                              )?.[1];
                              const enlaces = r.enlace
                                ? r.enlace.split(",").map((e) => e.trim()).filter(Boolean)
                                : [];
                                const savingEstado = saving === `${r._idx + 2}-6`;
                                const savingPrioridad = saving === `${r._idx + 2}-8`;
                                const savingTelefono = saving === `${r._idx + 2}-11`;

                                return (
                                <TableRow key={i} className="hover:bg-orange-50/30">
                                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                    {formatFecha(r.fecha)}
                                  </TableCell>
                                  <TableCell className="font-medium text-sm max-w-[180px] truncate" title={r.quien}>
                                    {limpiarNombre(r.quien)}
                                  </TableCell>
                                    <TableCell className="text-sm max-w-[250px] truncate" title={r.asunto}>
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
                                                  let val = e.target.value;
                                                  // Only allow numbers, +, -, and spaces in state
                                                  val = val.replace(/[^\d+ \-]/g, "");
                                                  setRegistros(prev => prev.map((item, idx) => idx === r._idx ? { ...item, telefono: val } : item));
                                                }}
                                                onBlur={(e) => {
                                                  updateCell(r._idx, 11, e.target.value);
                                                }}
                                                className={`w-full text-xs p-1.5 border rounded focus:ring-1 focus:ring-orange-500 outline-none pr-6 ${
                                                  savingTelefono ? "opacity-50" : ""
                                                } ${
                                                  r.estado?.toLowerCase() === "enviado" && !r.telefono
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
                                                href={getWhatsAppLink(r.telefono, r.quien, r.asunto, r.tipo, r.estado)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className={`shrink-0 p-2 rounded-md text-white transition-all shadow-sm hover:scale-105 active:scale-95 ${
                                                  r.estado?.toLowerCase() === "enviado"
                                                    ? "bg-green-600 hover:bg-green-700 animate-pulse-subtle"
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
                                      <EstadoDropdown
                                        tipo={r.tipo}
                                        estado={r.estado}
                                        saving={savingEstado}
                                        onChange={(val) => updateCell(r._idx, 6, val)}
                                      />
                                    </TableCell>
                                  <TableCell>
                                    {tipoCfg ? (
                                      <Badge variant="outline" className={`${tipoCfg.color} gap-1 text-xs font-normal`}>
                                        {tipoCfg.icon}
                                        {r.tipo}
                                      </Badge>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">{r.tipo || "—"}</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <select
                                      value={r.prioridad || ""}
                                      disabled={savingPrioridad}
                                      onChange={(e) => updateCell(r._idx, 8, e.target.value)}
                                      className={`text-xs font-medium rounded-md px-2 py-1.5 border cursor-pointer outline-none transition-colors ${
                                        savingPrioridad ? "opacity-50" : ""
                                      } ${
                                        r.prioridad?.toLowerCase().includes("urgente")
                                          ? "bg-red-100 text-red-700 border-red-200"
                                          : r.prioridad?.toLowerCase().includes("recogida")
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
                                        {enlaces.length > 1 ? `${enlaces.length}` : "Ver"}
                                      </a>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
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
              </TabsContent>
            ))}
          </Tabs>
        </Card>
      </main>
    </div>
  );
}

const ESTADO_OPTIONS: Record<string, { value: string; label: string; color: string }[]> = {
  pedido: [
    { value: "PENDIENTE (Pedido)", label: "Pendiente", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    { value: "En Curso", label: "En Curso", color: "bg-blue-100 text-blue-800 border-blue-200" },
    { value: "Enviado", label: "Enviado", color: "bg-green-100 text-green-800 border-green-200" },
  ],
  factura: [
    { value: "PENDIENTE (Factura)", label: "Pendiente", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    { value: "Revisada", label: "Revisada", color: "bg-blue-100 text-blue-800 border-blue-200" },
    { value: "Contabilizada", label: "Contabilizada", color: "bg-purple-100 text-purple-800 border-purple-200" },
    { value: "Pagada", label: "Pagada", color: "bg-green-100 text-green-800 border-green-200" },
  ],
  consulta: [
    { value: "PENDIENTE (Consulta)", label: "Pendiente", color: "bg-yellow-100 text-yellow-800 border-yellow-200" },
    { value: "Respondida", label: "Respondida", color: "bg-green-100 text-green-800 border-green-200" },
  ],
};

function getEstadoType(tipo: string, estado: string): string {
  const t = tipo.toLowerCase();
  const e = estado.toLowerCase();
  if (t.includes("pedido")) return "pedido";
  if (t.includes("factura") || e.includes("factura")) return "factura";
  if (t.includes("consulta")) return "consulta";
  return "pedido";
}

function getEstadoColor(estado: string, tipo: string): string {
  const options = ESTADO_OPTIONS[getEstadoType(tipo, estado)] || ESTADO_OPTIONS.pedido;
  const match = options.find((o) => o.value.toLowerCase() === estado.toLowerCase());
  return match?.color || "bg-gray-100 text-gray-700 border-gray-200";
}

function EstadoDropdown({
  tipo,
  estado,
  saving,
  onChange,
}: {
  tipo: string;
  estado: string;
  saving: boolean;
  onChange: (val: string) => void;
}) {
  const estadoType = getEstadoType(tipo, estado);
  const options = ESTADO_OPTIONS[estadoType] || ESTADO_OPTIONS.pedido;
  const colorClass = getEstadoColor(estado, tipo);

  // Normalize current estado to find match
  const currentMatch = options.find((o) => o.value.toLowerCase() === estado.toLowerCase());
  const currentValue = currentMatch ? currentMatch.value : estado;

  return (
    <select
      value={currentValue}
      disabled={saving}
      onChange={(e) => onChange(e.target.value)}
      className={`text-xs font-medium rounded-md px-2 py-1.5 border cursor-pointer outline-none transition-colors w-full ${
        saving ? "opacity-50" : ""
      } ${colorClass}`}
    >
      {!currentMatch && <option value={estado}>{estado || "Sin estado"}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
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
