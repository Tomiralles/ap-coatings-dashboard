"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  Package,
  FileText,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Truck,
  RefreshCw,
  Search,
  ExternalLink,
  Filter,
  MessageCircle,
  LayoutList,
  Columns,
  Bot,
  Send,
  X,
  RotateCcw,
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
import { ArrowRight } from "lucide-react";

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

interface RespuestaPendiente {
  id: string;
  fechaCreacion: string;
  tipo: "email" | "whatsapp";
  rowOrigen: string;
  destinatario: string;
  asunto: string;
  threadId: string;
  borrador: string;
  estado: "pendiente" | "aprobado" | "rechazado";
  enviadoEn: string;
  contextoJson: string;
}

interface RegistroConIdx extends Registro {
  _idx: number;
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

  const msgNombre = limpiarNombre(nombre).split(" ")[0];
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


export default function DashboardPage() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [activeTab, setActiveTab] = useState("todo");
  const [saving, setSaving] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [respuestas, setRespuestas] = useState<RespuestaPendiente[]>([]);
  const [generandoIA, setGenerandoIA] = useState<string | null>(null);

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
        // Trigger IA cuando el pedido se marca como "Enviado"
        if (columna === 6 && valor === "Enviado" && registroActual.tipo.toLowerCase().includes("pedido")) {
          const registroActualizado = { ...registroActual, estado: valor };
          generarRespuesta(rowIndex, "email", registroActualizado);
          if (registroActual.telefono) {
            generarRespuesta(rowIndex, "whatsapp", registroActualizado);
          }
        }
      } else {
        alert("Error al guardar: " + (data.error || "desconocido"));
      }
    } catch {
      alert("Error de conexion al guardar");
    } finally {
      setSaving(null);
    }
  }, [registros]);

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

  const fetchRespuestas = async () => {
    try {
      const res = await fetch("/api/respuestas");
      const json = await res.json();
      if (!json.error) setRespuestas(json.respuestas ?? []);
    } catch { /* silencioso */ }
  };

  const generarRespuesta = async (
    rowIndex: number,
    tipo: "email" | "whatsapp",
    registro: Registro
  ) => {
    const key = `${rowIndex}-${tipo}`;
    setGenerandoIA(key);
    try {
      const contexto = {
        quien: registro.quien,
        asunto: registro.asunto,
        cuerpo: registro.cuerpo,
        tipo: registro.tipo,
        estado: registro.estado,
      };

      const res = await fetch("/api/claude/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, contexto }),
      });
      const { borrador } = await res.json();
      if (!borrador) return;

      await fetch("/api/respuestas/crear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          rowOrigen: String(rowIndex + 2),
          destinatario: tipo === "email"
            ? registro.quien.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/)?.[0] ?? registro.quien
            : registro.telefono,
          asunto: `Re: ${registro.asunto.replace(/^"+|"+$/g, "")}`,
          threadId: "",
          borrador,
          contextoJson: JSON.stringify(contexto),
        }),
      });

      await fetchRespuestas();
    } catch (err) {
      console.error("Error generando respuesta IA:", err);
    } finally {
      setGenerandoIA(null);
    }
  };

  useEffect(() => {
    fetchData();
    fetchRespuestas();
    const interval = setInterval(fetchRespuestas, 30000);
    return () => clearInterval(interval);
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

        const esFactura = r.tipo.toLowerCase().includes("factura") ||
          r.estado.toLowerCase().includes("factura") ||
          ["revisada", "contabilizada", "pagada"].includes(r.estado.toLowerCase());

        if (activeTab === "pedidos") return matchSearch && matchEstado && r.tipo.toLowerCase().includes("pedido");
        if (activeTab === "facturas") return matchSearch && matchEstado && esFactura;
        if (activeTab === "consultas") return matchSearch && matchEstado && r.tipo.toLowerCase().includes("consulta");
        return matchSearch && matchEstado && matchTipo;
      });
  }, [registros, search, filtroEstado, filtroTipo, activeTab]);

  const stats = useMemo(() => {
    const pedidos = registros.filter((r) => r.tipo.toLowerCase().includes("pedido"));
    const facturas = registros.filter((r) => r.tipo.toLowerCase().includes("factura") || r.estado.toLowerCase().includes("factura") || ["revisada", "contabilizada", "pagada"].includes(r.estado.toLowerCase()));
    const consultas = registros.filter((r) => r.tipo.toLowerCase().includes("consulta"));
    const urgentes = registros.filter((r) => r.prioridad.toLowerCase().includes("urgente"));
    const enCurso = registros.filter((r) => r.estado.toLowerCase().includes("en curso"));
    const enviados = registros.filter((r) => r.estado.toLowerCase() === "enviado");

    return { pedidos, facturas, consultas, urgentes, enCurso, enviados };
  }, [registros]);

  const funnelFacturas = useMemo(() => {
    const total = stats.facturas.length;
    const etapas = [
      { label: "Pendiente", color: "bg-yellow-400", textColor: "text-yellow-700", bg: "bg-yellow-50", count: stats.facturas.filter((r) => r.estado.toLowerCase().includes("pendiente")).length },
      { label: "Revisada", color: "bg-blue-400", textColor: "text-blue-700", bg: "bg-blue-50", count: stats.facturas.filter((r) => r.estado.toLowerCase() === "revisada").length },
      { label: "Contabilizada", color: "bg-purple-400", textColor: "text-purple-700", bg: "bg-purple-50", count: stats.facturas.filter((r) => r.estado.toLowerCase() === "contabilizada").length },
      { label: "Pagada", color: "bg-green-400", textColor: "text-green-700", bg: "bg-green-50", count: stats.facturas.filter((r) => r.estado.toLowerCase() === "pagada").length },
    ];
    return { etapas, total };
  }, [stats.facturas]);

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
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground">Panel de control - Pedidos y Facturas</p>
                {respuestas.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-500 text-white animate-pulse">
                    <Bot className="h-3 w-3" />
                    {respuestas.length}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center rounded-md border overflow-hidden">
              <button
                onClick={() => setViewMode("table")}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                  viewMode === "table"
                    ? "bg-orange-500 text-white"
                    : "hover:bg-gray-50 text-gray-600"
                }`}
                title="Vista tabla"
              >
                <LayoutList className="h-4 w-4" />
                <span className="hidden sm:inline">Tabla</span>
              </button>
              <button
                onClick={() => setViewMode("kanban")}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                  viewMode === "kanban"
                    ? "bg-orange-500 text-white"
                    : "hover:bg-gray-50 text-gray-600"
                }`}
                title="Vista Kanban"
              >
                <Columns className="h-4 w-4" />
                <span className="hidden sm:inline">Kanban</span>
              </button>
            </div>
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

        {/* Funnel + Urgentes */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Funnel de facturas */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-violet-500" />
                Flujo de facturas
                <span className="ml-auto text-xs font-normal text-muted-foreground">{funnelFacturas.total} total</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {funnelFacturas.etapas.map((etapa, i) => {
                const pct = funnelFacturas.total > 0 ? Math.round((etapa.count / funnelFacturas.total) * 100) : 0;
                return (
                  <div key={etapa.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
                        <span className="text-sm font-medium">{etapa.label}</span>
                      </div>
                      <span className={`text-sm font-bold ${etapa.textColor}`}>{etapa.count}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${etapa.color} transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{pct}% del total</p>
                  </div>
                );
              })}
              {funnelFacturas.total === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Sin facturas registradas</p>
              )}
            </CardContent>
          </Card>

          {/* Panel de urgentes */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Urgentes
                <span className="ml-auto text-xs font-normal text-muted-foreground">{stats.urgentes.length} registros</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats.urgentes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <CheckCircle2 className="h-8 w-8 text-green-400" />
                  <p className="text-sm text-muted-foreground">Sin urgencias pendientes</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.urgentes.slice(0, 5).map((r, i) => {
                    const tipoCfg = Object.entries(TIPO_CONFIG).find(([k]) =>
                      r.tipo.toLowerCase().includes(k.toLowerCase())
                    )?.[1];
                    return (
                      <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-red-50 border border-red-100">
                        <div className="shrink-0 mt-0.5">
                          {tipoCfg ? (
                            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${tipoCfg.color}`}>
                              {tipoCfg.icon}{r.tipo}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800 truncate">{limpiarNombre(r.quien)}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{r.asunto.replace(/^"+|"+$/g, "")}</p>
                        </div>
                        <span className="text-[11px] shrink-0 px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
                          {r.estado || "Sin estado"}
                        </span>
                      </div>
                    );
                  })}
                  {stats.urgentes.length > 5 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      +{stats.urgentes.length - 5} más — filtra por Urgente en la tabla
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Cola de Respuestas IA */}
        {respuestas.length > 0 && (
          <ColaRespuestas
            respuestas={respuestas}
            onRespuestasChange={fetchRespuestas}
            onRemove={(id) => setRespuestas(prev => prev.filter(r => r.id !== id))}
          />
        )}

        {/* Filters + Table/Kanban */}
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
                {viewMode === "table" ? (
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
                            <TableHead className="w-[48px]">IA</TableHead>
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
                                  <TableCell>
                                    {(r.tipo.toLowerCase().includes("pedido") || r.tipo.toLowerCase().includes("consulta")) && (
                                      <button
                                        title="Generar respuesta con IA"
                                        disabled={!!generandoIA}
                                        onClick={() => generarRespuesta(r._idx, "email", r)}
                                        className="p-1.5 rounded-md text-orange-500 hover:bg-orange-50 disabled:opacity-40 transition-colors"
                                      >
                                        {generandoIA === `${r._idx}-email`
                                          ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                          : <Bot className="h-3.5 w-3.5" />
                                        }
                                      </button>
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
                ) : (
                  <CardContent className="p-4">
                    <KanbanBoard
                      filtrados={filtrados}
                      activeTab={activeTab}
                      updateCell={updateCell}
                      saving={saving}
                      setRegistros={setRegistros}
                    />
                  </CardContent>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </Card>
      </main>
    </div>
  );
}

// ─── Cola de Respuestas IA ────────────────────────────────────────────────────

function ColaRespuestas({
  respuestas,
  onRespuestasChange,
  onRemove,
}: {
  respuestas: RespuestaPendiente[];
  onRespuestasChange: () => Promise<void>;
  onRemove: (id: string) => void;
}) {
  const [borradores, setBorradores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [regenerando, setRegenerando] = useState<string | null>(null);

  const getBorrador = (r: RespuestaPendiente) =>
    borradores[r.id] !== undefined ? borradores[r.id] : r.borrador;

  const handleAprobar = async (r: RespuestaPendiente) => {
    setEnviando(r.id);
    try {
      const res = await fetch("/api/respuestas/aprobar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: r.id,
          tipo: r.tipo,
          destinatario: r.destinatario,
          asunto: r.asunto,
          threadId: r.threadId,
          borradorFinal: getBorrador(r),
          contextoJson: r.contextoJson,
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        alert("Error al enviar: " + (data.error || "desconocido"));
        return;
      }
      onRemove(r.id);
      onRespuestasChange();
    } catch {
      alert("Error de conexión al enviar");
    } finally {
      setEnviando(null);
    }
  };

  const handleRechazar = async (r: RespuestaPendiente) => {
    setEnviando(r.id);
    try {
      await fetch("/api/respuestas/rechazar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: r.id }),
      });
      onRemove(r.id);
      onRespuestasChange();
    } catch {
      alert("Error al rechazar");
    } finally {
      setEnviando(null);
    }
  };

  const handleRegenerar = async (r: RespuestaPendiente) => {
    setRegenerando(r.id);
    try {
      let contexto = { quien: r.destinatario, asunto: r.asunto, cuerpo: "", tipo: r.tipo === "whatsapp" ? "Pedido" : "Consulta", estado: "" };
      try { contexto = { ...contexto, ...JSON.parse(r.contextoJson) }; } catch { /* ok */ }

      const res = await fetch("/api/claude/generar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: r.tipo, contexto }),
      });
      const { borrador } = await res.json();
      if (borrador) setBorradores((prev) => ({ ...prev, [r.id]: borrador }));
    } catch {
      alert("Error al regenerar");
    } finally {
      setRegenerando(null);
    }
  };

  return (
    <Card className="border-orange-200 bg-orange-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-orange-500 flex items-center justify-center">
            <Bot className="h-4 w-4 text-white" />
          </div>
          <CardTitle className="text-base">Respuestas pendientes de aprobación</CardTitle>
          <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500 text-white">
            {respuestas.length}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {respuestas.map((r) => {
          const isEnviando = enviando === r.id;
          const isRegenerando = regenerando === r.id;
          const disabled = isEnviando || isRegenerando;

          return (
            <div key={r.id} className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
              {/* Header de la tarjeta */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
                    r.tipo === "whatsapp"
                      ? "bg-green-100 text-green-700 border-green-200"
                      : "bg-blue-100 text-blue-700 border-blue-200"
                  }`}>
                    {r.tipo === "whatsapp" ? <MessageCircle className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                    {r.tipo === "whatsapp" ? "WhatsApp" : "Email"}
                  </span>
                  <span className="text-sm font-medium truncate max-w-[240px]">{r.destinatario}</span>
                  {r.asunto && (
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">{r.asunto}</span>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">
                  {r.fechaCreacion ? new Date(r.fechaCreacion).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}
                </span>
              </div>

              {/* Textarea editable con el borrador */}
              <textarea
                className="w-full text-sm border rounded-lg p-3 resize-none focus:ring-2 focus:ring-orange-400 outline-none bg-gray-50 min-h-[100px]"
                value={getBorrador(r)}
                disabled={disabled}
                onChange={(e) => setBorradores((prev) => ({ ...prev, [r.id]: e.target.value }))}
                rows={4}
              />

              {/* Botones de acción */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleAprobar(r)}
                  disabled={disabled}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded-md transition-colors disabled:opacity-50"
                >
                  {isEnviando ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Aprobar y enviar
                </button>
                <button
                  onClick={() => handleRegenerar(r)}
                  disabled={disabled}
                  className="flex items-center gap-1.5 px-3 py-1.5 border hover:bg-gray-50 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                >
                  {isRegenerando ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Regenerar
                </button>
                <button
                  onClick={() => handleRechazar(r)}
                  disabled={disabled}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ml-auto"
                >
                  <X className="h-3.5 w-3.5" />
                  Rechazar
                </button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─── Kanban ───────────────────────────────────────────────────────────────────

const KANBAN_COLUMNS: Record<string, { label: string; estados: string[]; color: string; headerColor: string }[]> = {
  todo: [
    { label: "Pendiente", estados: ["PENDIENTE (Pedido)", "PENDIENTE (Factura)", "PENDIENTE (Consulta)"], color: "bg-yellow-50 border-yellow-200", headerColor: "bg-yellow-100 text-yellow-800" },
    { label: "En Proceso", estados: ["En Curso", "Revisada"], color: "bg-blue-50 border-blue-200", headerColor: "bg-blue-100 text-blue-800" },
    { label: "Completado", estados: ["Enviado", "Contabilizada", "Pagada", "Respondida"], color: "bg-green-50 border-green-200", headerColor: "bg-green-100 text-green-800" },
  ],
  pedidos: [
    { label: "Pendiente", estados: ["PENDIENTE (Pedido)"], color: "bg-yellow-50 border-yellow-200", headerColor: "bg-yellow-100 text-yellow-800" },
    { label: "En Curso", estados: ["En Curso"], color: "bg-blue-50 border-blue-200", headerColor: "bg-blue-100 text-blue-800" },
    { label: "Enviado", estados: ["Enviado"], color: "bg-green-50 border-green-200", headerColor: "bg-green-100 text-green-800" },
  ],
  facturas: [
    { label: "Pendiente", estados: ["PENDIENTE (Factura)"], color: "bg-yellow-50 border-yellow-200", headerColor: "bg-yellow-100 text-yellow-800" },
    { label: "Revisada", estados: ["Revisada"], color: "bg-blue-50 border-blue-200", headerColor: "bg-blue-100 text-blue-800" },
    { label: "Contabilizada", estados: ["Contabilizada"], color: "bg-purple-50 border-purple-200", headerColor: "bg-purple-100 text-purple-800" },
    { label: "Pagada", estados: ["Pagada"], color: "bg-green-50 border-green-200", headerColor: "bg-green-100 text-green-800" },
  ],
  consultas: [
    { label: "Pendiente", estados: ["PENDIENTE (Consulta)"], color: "bg-yellow-50 border-yellow-200", headerColor: "bg-yellow-100 text-yellow-800" },
    { label: "Respondida", estados: ["Respondida"], color: "bg-green-50 border-green-200", headerColor: "bg-green-100 text-green-800" },
  ],
};

// Resolve the exact estado value to assign when dropping into a column for a given tab/tipo
function resolveDropEstado(colEstados: string[], tipo: string, tab: string): string {
  // For specific tabs, there's only one estado per column — use it directly
  if (tab !== "todo") return colEstados[0];
  // For "todo" tab, resolve by tipo
  const t = tipo.toLowerCase();
  if (colEstados.some((e) => e.toLowerCase().includes("pendiente"))) {
    if (t.includes("factura")) return "PENDIENTE (Factura)";
    if (t.includes("consulta")) return "PENDIENTE (Consulta)";
    return "PENDIENTE (Pedido)";
  }
  if (colEstados.includes("Enviado") || colEstados.includes("Pagada") || colEstados.includes("Respondida")) {
    if (t.includes("factura")) return "Pagada";
    if (t.includes("consulta")) return "Respondida";
    return "Enviado";
  }
  if (colEstados.includes("En Curso") || colEstados.includes("Revisada")) {
    if (t.includes("factura")) return "Revisada";
    return "En Curso";
  }
  return colEstados[0];
}

function KanbanBoard({
  filtrados,
  activeTab,
  updateCell,
  saving,
  setRegistros,
}: {
  filtrados: RegistroConIdx[];
  activeTab: string;
  updateCell: (rowIndex: number, columna: number, valor: string) => Promise<void>;
  saving: string | null;
  setRegistros: React.Dispatch<React.SetStateAction<Registro[]>>;
}) {
  const columns = KANBAN_COLUMNS[activeTab] || KANBAN_COLUMNS.todo;
  const dragIdx = useRef<number | null>(null);

  const getCardsForColumn = (colEstados: string[]) => {
    const lowerEstados = colEstados.map((e) => e.toLowerCase());
    return filtrados.filter((r) => lowerEstados.includes(r.estado.toLowerCase()));
  };

  // Cards with no matching column go to first column
  const unmatchedCards = filtrados.filter((r) => {
    const allEstados = columns.flatMap((c) => c.estados.map((e) => e.toLowerCase()));
    return !allEstados.includes(r.estado.toLowerCase());
  });

  const handleDrop = async (e: React.DragEvent, colEstados: string[]) => {
    e.preventDefault();
    const idx = dragIdx.current;
    if (idx === null) return;
    const registro = filtrados.find((r) => r._idx === idx);
    if (!registro) return;
    const newEstado = resolveDropEstado(colEstados, registro.tipo, activeTab);
    if (newEstado.toLowerCase() === registro.estado.toLowerCase()) return;
    // Optimistic update
    setRegistros((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, estado: newEstado } : r))
    );
    await updateCell(idx, 6, newEstado);
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((col) => {
        let cards = getCardsForColumn(col.estados);
        // Attach unmatched cards to first column
        if (col === columns[0]) cards = [...unmatchedCards, ...cards];

        return (
          <div
            key={col.label}
            className={`flex-shrink-0 w-72 rounded-xl border-2 ${col.color} flex flex-col`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, col.estados)}
          >
            {/* Column header */}
            <div className={`px-3 py-2 rounded-t-xl flex items-center justify-between ${col.headerColor}`}>
              <span className="text-sm font-semibold">{col.label}</span>
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/60">
                {cards.length}
              </span>
            </div>
            {/* Cards */}
            <div className="flex flex-col gap-2 p-2 min-h-[120px]">
              {cards.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-8">
                  <p className="text-xs text-muted-foreground">Sin registros</p>
                </div>
              ) : (
                cards.map((r) => (
                  <KanbanCard
                    key={r._idx}
                    registro={r}
                    saving={saving === `${r._idx + 2}-6`}
                    onDragStart={() => { dragIdx.current = r._idx; }}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  registro: r,
  saving,
  onDragStart,
}: {
  registro: RegistroConIdx;
  saving: boolean;
  onDragStart: () => void;
}) {
  const tipoCfg = Object.entries(TIPO_CONFIG).find(([k]) =>
    r.tipo.toLowerCase().includes(k.toLowerCase())
  )?.[1];

  const enlaces = r.enlace
    ? r.enlace.split(",").map((e) => e.trim()).filter(Boolean)
    : [];

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`bg-white rounded-lg border shadow-sm p-3 cursor-grab active:cursor-grabbing select-none transition-opacity ${
        saving ? "opacity-50" : "hover:shadow-md"
      }`}
    >
      {/* Top row: tipo badge + prioridad */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {tipoCfg && (
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded border ${tipoCfg.color}`}>
              {tipoCfg.icon}
              {r.tipo}
            </span>
          )}
          {r.prioridad?.toLowerCase().includes("urgente") && (
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border bg-red-100 text-red-700 border-red-200">
              Urgente
            </span>
          )}
          {r.prioridad?.toLowerCase().includes("recogida") && (
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border bg-blue-100 text-blue-700 border-blue-200">
              Recogida
            </span>
          )}
        </div>
        {saving && <RefreshCw className="h-3 w-3 animate-spin text-gray-400 shrink-0" />}
      </div>

      {/* Client name */}
      <p className="text-sm font-semibold text-gray-800 truncate" title={r.quien}>
        {limpiarNombre(r.quien)}
      </p>

      {/* Subject */}
      <p className="text-xs text-muted-foreground truncate mt-0.5" title={r.asunto}>
        {r.asunto.replace(/^"+|"+$/g, "")}
      </p>

      {/* Bottom row: date + actions */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-[11px] text-muted-foreground">{formatFecha(r.fecha)}</span>
        <div className="flex items-center gap-1">
          {enlaces.length > 0 && (
            <a
              href={enlaces[0]}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded text-blue-500 hover:bg-blue-50"
              title="Ver documento"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {r.telefono && (
            <a
              href={getWhatsAppLink(r.telefono, r.quien, r.asunto, r.tipo, r.estado)}
              target="_blank"
              rel="noopener noreferrer"
              className={`p-1 rounded text-white transition-colors ${
                r.estado?.toLowerCase() === "enviado"
                  ? "bg-green-500 hover:bg-green-600"
                  : "bg-gray-400 hover:bg-gray-500"
              }`}
              title="Abrir WhatsApp"
              onClick={(e) => e.stopPropagation()}
            >
              <MessageCircle className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Supporting components ────────────────────────────────────────────────────

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
