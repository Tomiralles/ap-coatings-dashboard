import Link from "next/link";
import { Package, ArrowLeft } from "lucide-react";

export default function PedidosPage() {
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
              <p className="text-xs text-muted-foreground">Pedidos</p>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-md border hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <p className="text-muted-foreground text-sm">Sección de pedidos en construcción.</p>
      </main>
    </div>
  );
}
