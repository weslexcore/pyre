"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Offering } from "@/lib/database.types";

interface ScheduleListProps {
  offerings: Offering[];
  onBooking?: (offeringId: string) => void;
  showBookingButton?: boolean;
}

export function ScheduleList({ 
  offerings, 
  onBooking, 
  showBookingButton = false 
}: ScheduleListProps) {
  const [groupedOfferings, setGroupedOfferings] = useState<Record<string, Offering[]>>({});

  useEffect(() => {
    // Group offerings by date
    const grouped = offerings.reduce((acc, offering) => {
      const date = offering.date;
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(offering);
      return acc;
    }, {} as Record<string, Offering[]>);

    setGroupedOfferings(grouped);
  }, [offerings]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const getSessionTypeColor = (sessionType: string) => {
    switch (sessionType.toLowerCase()) {
      case 'sauna':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'cold plunge':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'sauna + cold plunge combo':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const isFullyBooked = (offering: Offering) => offering.available_slots === 0;
  const isAlmostFull = (offering: Offering) => 
    offering.available_slots <= Math.ceil(offering.total_slots * 0.2) && offering.available_slots > 0;

  if (offerings.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No sessions available at this time.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {Object.entries(groupedOfferings)
        .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
        .map(([date, dayOfferings]) => (
          <div key={date} className="space-y-4">
            <h3 className="text-lg font-semibold border-b pb-2">
              {formatDate(date)}
            </h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {dayOfferings
                .sort((a, b) => a.time.localeCompare(b.time))
                .map((offering) => (
                  <Card 
                    key={offering.id} 
                    className={`transition-all hover:shadow-md ${
                      isFullyBooked(offering) ? 'opacity-60' : ''
                    }`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-base">
                          {formatTime(offering.time)}
                        </CardTitle>
                        <Badge 
                          variant="outline" 
                          className={getSessionTypeColor(offering.session_type)}
                        >
                          {offering.session_type}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <div className="text-sm text-muted-foreground">
                          📍 {offering.location?.name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {offering.location?.address}
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="text-lg font-semibold">
                          ${offering.cost.toFixed(2)}
                        </div>
                        <div className="text-sm">
                          {isFullyBooked(offering) ? (
                            <Badge variant="destructive">Fully Booked</Badge>
                          ) : isAlmostFull(offering) ? (
                            <Badge variant="secondary">
                              Only {offering.available_slots} left
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">
                              {offering.available_slots} of {offering.total_slots} available
                            </span>
                          )}
                        </div>
                      </div>

                      {showBookingButton && onBooking && (
                        <Button 
                          onClick={() => onBooking(offering.id)}
                          disabled={isFullyBooked(offering)}
                          className="w-full"
                        >
                          {isFullyBooked(offering) ? 'Fully Booked' : 'Book Session'}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        ))}
    </div>
  );
}