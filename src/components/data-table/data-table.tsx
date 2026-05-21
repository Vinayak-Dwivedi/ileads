"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDownIcon, Columns3Icon, SearchIcon } from "lucide-react";

import { DataTablePagination } from "@/components/data-table/data-table-pagination";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  className?: string;
  columnLabels?: Record<string, string>;
  emptyMessage?: string;
  enableColumnVisibility?: boolean;
  getRowId?: (originalRow: TData, index: number) => string;
  initialPageSize?: number;
  initialColumnVisibility?: VisibilityState;
  initialSorting?: SortingState;
  itemLabel?: string;
  pageSizeOptions?: number[];
  searchColumnId?: string;
  searchPlaceholder?: string;
  showFilteredCount?: boolean;
  showSelectionCount?: boolean;
  tableClassName?: string;
  toolbarActions?: React.ReactNode;
}

function humanizeColumnId(columnId: string) {
  return columnId
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function DataTable<TData, TValue>({
  columns,
  data,
  className,
  columnLabels,
  emptyMessage = "No results.",
  enableColumnVisibility = true,
  getRowId,
  initialPageSize = 10,
  initialColumnVisibility = {},
  initialSorting = [],
  itemLabel = "rows",
  pageSizeOptions,
  searchColumnId,
  searchPlaceholder,
  showFilteredCount = true,
  showSelectionCount = false,
  tableClassName,
  toolbarActions,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>(initialColumnVisibility);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const [globalFilter, setGlobalFilter] = React.useState("");

  const table = useReactTable({
    data,
    columns,
    getRowId,
    globalFilterFn: "includesString",
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      columnFilters,
      columnVisibility,
      globalFilter,
      pagination,
      rowSelection,
      sorting,
    },
  });

  const searchableColumn = searchColumnId ? table.getColumn(searchColumnId) : undefined;
  const searchValue = searchableColumn
    ? ((searchableColumn.getFilterValue() as string | undefined) ?? "")
    : globalFilter;
  const hideableColumns = table
    .getAllColumns()
    .filter((column) => column.getCanHide());
  const hasToolbar =
    Boolean(searchPlaceholder) ||
    Boolean(toolbarActions) ||
    (enableColumnVisibility && hideableColumns.length > 0);

  function handleSearch(value: string) {
    table.setPageIndex(0);
    if (searchableColumn) {
      searchableColumn.setFilterValue(value);
      return;
    }

    setGlobalFilter(value);
  }

  return (
    <div className={cn("space-y-3", className)}>
      {hasToolbar ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {searchPlaceholder ? (
            <div className="relative w-full sm:max-w-sm">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchValue}
                onChange={(event) => handleSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="bg-background pl-8"
              />
            </div>
          ) : (
            <div />
          )}

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {toolbarActions}
            {enableColumnVisibility && hideableColumns.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <Columns3Icon data-icon="inline-start" />
                    Columns
                    <ChevronDownIcon data-icon="inline-end" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {hideableColumns.map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    >
                      {columnLabels?.[column.id] ?? humanizeColumnId(column.id)}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <Table className={tableClassName}>
          <TableHeader className="bg-slate-50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={
                      (header.column.columnDef.meta as { headClassName?: string } | undefined)
                        ?.headClassName
                    }
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={
                        (cell.column.columnDef.meta as { cellClassName?: string } | undefined)
                          ?.cellClassName
                      }
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination
        table={table}
        itemLabel={itemLabel}
        pageSizeOptions={pageSizeOptions}
        showFilteredCount={showFilteredCount}
        showSelectionCount={showSelectionCount}
      />
    </div>
  );
}
