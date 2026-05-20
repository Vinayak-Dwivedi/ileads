"use client";

import type { Table } from "@tanstack/react-table";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
  itemLabel?: string;
  pageSizeOptions?: number[];
  showFilteredCount?: boolean;
  showSelectionCount?: boolean;
}

export function DataTablePagination<TData>({
  table,
  itemLabel = "rows",
  pageSizeOptions = [10, 20, 30, 50],
  showFilteredCount = true,
  showSelectionCount = false,
}: DataTablePaginationProps<TData>) {
  const pageCount = table.getPageCount();
  const currentPage = pageCount > 0 ? table.getState().pagination.pageIndex + 1 : 0;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="flex flex-col gap-3 px-1 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        {showSelectionCount ? (
          <>
            {table.getFilteredSelectedRowModel().rows.length} of {filteredCount}{" "}
            selected.
          </>
        ) : showFilteredCount ? (
          <>
            {filteredCount.toLocaleString()} {itemLabel}
          </>
        ) : (
          <span className="sr-only">Pagination controls</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        <div className="flex items-center gap-2">
          <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
            Rows per page
          </span>
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => table.setPageSize(Number(value))}
          >
            <SelectTrigger size="sm" className="w-[76px]" aria-label="Rows per page">
              <SelectValue placeholder={table.getState().pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              <SelectGroup>
                {pageSizeOptions.map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-24 text-center text-sm font-medium">
          Page {currentPage} of {pageCount}
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="hidden sm:inline-flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeftIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="hidden sm:inline-flex"
            onClick={() => table.setPageIndex(Math.max(pageCount - 1, 0))}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
