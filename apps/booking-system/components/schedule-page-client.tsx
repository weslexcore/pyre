"use client";

import { useState } from "react";
import { ScheduleInfinite } from "@/components/schedule-infinite";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { getActiveLocations, getSessionTypes } from "@/lib/supabase/client-queries";
import { Filter, X } from "lucide-react";

export function SchedulePageClient() {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    locationId: '',
    sessionType: '',
    dateFrom: '',
    dateTo: ''
  });

  // Fetch filter options
  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: getActiveLocations,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const { data: sessionTypes = [] } = useQuery({
    queryKey: ['sessionTypes'],
    queryFn: getSessionTypes,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const hasActiveFilters = Object.values(filters).some(value => value !== '');

  const clearFilters = () => {
    setFilters({
      locationId: '',
      sessionType: '',
      dateFrom: '',
      dateTo: ''
    });
  };

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-sans font-bold tracking-tight">SESSION SCHEDULE</h1>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2"
          >
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 bg-primary text-primary-foreground rounded-full text-xs px-1.5 py-0.5 min-w-[1.25rem] h-5 flex items-center justify-center">
                {Object.values(filters).filter(v => v !== '').length}
              </span>
            )}
          </Button>
        </div>
        <p className="text-muted-foreground font-sans">
          Discover and book your next session
        </p>
      </div>

      {/* Filters Card */}
      {showFilters && (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-sans">Filter Sessions</CardTitle>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear all
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label htmlFor="location-filter">Location</Label>
                <select
                  id="location-filter"
                  className="w-full p-2 border rounded-md"
                  value={filters.locationId}
                  onChange={(e) => updateFilter('locationId', e.target.value)}
                >
                  <option value="">All Locations</option>
                  {locations.map(location => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="session-type-filter">Session Type</Label>
                <select
                  id="session-type-filter"
                  className="w-full p-2 border rounded-md"
                  value={filters.sessionType}
                  onChange={(e) => updateFilter('sessionType', e.target.value)}
                >
                  <option value="">All Types</option>
                  {sessionTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="date-from-filter">From Date</Label>
                <Input
                  id="date-from-filter"
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => updateFilter('dateFrom', e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="date-to-filter">To Date</Label>
                <Input
                  id="date-to-filter"
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => updateFilter('dateTo', e.target.value)}
                  min={filters.dateFrom || new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Infinite Scroll Schedule */}
      <ScheduleInfinite 
        filters={filters}
        showBookingButton={false} // Will enable once we have booking flow
      />
    </div>
  );
}