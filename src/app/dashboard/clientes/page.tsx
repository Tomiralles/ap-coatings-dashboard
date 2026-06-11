"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, RefreshCw, Pause, Play, Trash2, X, Check, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

// ─────────────────────────────────────────────
//  Tipos y constantes
// ─────────────────────────────────────────────

interface Cliente {
  id: number;
  slug: string;
  nombre: string;
  sector: string;
  phone_number_id: string;
  access_token: string; // viene enmascarado
  template_name: string;
  template_language: string;
  activo: boolean;
  creado_en?: string;
}

const SECTORES: { value: string; label: string; emoji: string }[] = [
  { value: "taller", label: "Taller mecánico", emoji: "🔧" },
  { value: "clinica", label: "Clínica estética", emoji: "💅" },
  { value: "restaurante", label: "Restaurante", emoji: "🍽️" },
  { value: "peluqueria", label: "Peluquería", emoji: "💇" },
  { value: "dentista", label: "Clínica dental", emoji: "🦷" },
  { value: "otro", label: "Otro negocio", emoji: "🏢" },
];

function emojiSector(sector: string): string {
  return SECTORES.find((s) => s.value === sector)?.emoji ?? "🏢";
}

const FORM_VACIO = {
  slug: "",
  nombre: "",
  sector: "taller",
  phone_number_id: "",
  access_token: "",
  template_name: "notificacion_cita",
  template_language: "es",
};

// ─────────────────────────────────────────────
//  Página
// ─────────────────────────────────────────────

export default function ClientesPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogAbierto, setDialogAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await fetch("/api/clientes-wa");
      const data = await res.json();
      if (data.ok) setClientes(data.clientes);
      else setError(data.error ?? "Error al cargar");
    } catch (e) {
      setError(String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Crear nuevo cliente
  async function guardar() {
    if (!form.slug || !form.nombre || !form.phone_number_id || !form.access_token) {
      setError("Rellena todos los campos obligatorios");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch("/api/clientes-wa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.ok) {
        setDialogAbierto(false);
        setForm(FORM_VACIO);
        await cargar();
      } else {
        setError(data.error ?? "Error al guardar");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGuardando(false);
    }
  }

  // Activar/pausar (reusa POST con activo)
  async function toggleActivo(c: Cliente) {
    try {
      await fetch("/api/clientes-wa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: c.slug,
          nombre: c.nombre,
          sector: c.sector,
          phone_number_id: c.phone_number_id,
          access_token: c.access_token, // enmascarado; la API lo ignora y conserva el real
          activo: !c.activo,
        }),
      });
      await cargar();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* Cabecera */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-1 transition-colors"
          >
            <ArrowLeft size={12} /> Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Mis clientes</h1>
          <p className="text-sm text-muted-foreground">
            {clientes.length} {clientes.length === 1 ? "cliente" : "clientes"} ·
            WhatsApp Business
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={cargar} title="Refrescar">
            <RefreshCw className={cargando ? "animate-spin" : ""} size={16} />
          </Button>
          <Button onClick={() => { setForm(FORM_VACIO); setError(null); setDialogAbierto(true); }}>
            <Plus size={16} className="mr-1" /> Nuevo cliente
          </Button>
        </div>
      </div>

      {/* Error global */}
      {error && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Lista */}
      {cargando ? (
        <p className="text-center text-muted-foreground py-12">Cargando…</p>
      ) : clientes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aún no tienes clientes. Pulsa <b>“Nuevo cliente”</b> para añadir el primero.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {clientes.map((c) => (
            <Card key={c.id} className={c.activo ? "" : "opacity-60"}>
              <CardContent className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{emojiSector(c.sector)}</span>
                  <div>
                    <div className="font-medium">{c.nombre}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.slug} · {SECTORES.find((s) => s.value === c.sector)?.label}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={c.activo ? "default" : "secondary"}>
                    {c.activo ? "activo" : "pausado"}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={c.activo ? "Pausar" : "Activar"}
                    onClick={() => toggleActivo(c)}
                  >
                    {c.activo ? <Pause size={16} /> : <Play size={16} />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog nuevo cliente */}
      <Dialog open={dialogAbierto} onOpenChange={setDialogAbierto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="nombre">Nombre del negocio *</Label>
              <Input
                id="nombre"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Taller García"
              />
            </div>

            <div>
              <Label htmlFor="slug">Identificador (slug) *</Label>
              <Input
                id="slug"
                value={form.slug}
                onChange={(e) =>
                  setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
                }
                placeholder="taller-garcia"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Sin espacios. Se usa internamente para identificar al cliente.
              </p>
            </div>

            <div>
              <Label>Sector</Label>
              <Select value={form.sector} onValueChange={(v) => setForm({ ...form, sector: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SECTORES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.emoji} {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="phone">Phone Number ID (Meta) *</Label>
              <Input
                id="phone"
                value={form.phone_number_id}
                onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                placeholder="123456789012345"
              />
            </div>

            <div>
              <Label htmlFor="token">Access Token (Meta) *</Label>
              <Input
                id="token"
                type="password"
                value={form.access_token}
                onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                placeholder="EAABcd..."
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Usa un System User Token (permanente), no el temporal de 24h.
              </p>
            </div>

            <div>
              <Label htmlFor="template">Nombre de plantilla</Label>
              <Input
                id="template"
                value={form.template_name}
                onChange={(e) => setForm({ ...form, template_name: e.target.value })}
                placeholder="notificacion_cita"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogAbierto(false)} disabled={guardando}>
              <X size={16} className="mr-1" /> Cancelar
            </Button>
            <Button onClick={guardar} disabled={guardando}>
              <Check size={16} className="mr-1" /> {guardando ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
