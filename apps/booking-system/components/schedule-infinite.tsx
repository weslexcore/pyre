"use client";

import { useState, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Clock } from "lucide-react";
import { Offering } from "@/lib/database.types";
import { getOfferingsInfinite, OfferingFilters } from "@/lib/supabase/client-queries";
import { SessionDetailsModal } from "@/components/session-details-modal";
import { truncateToLines } from "@/lib/utils";

interface ScheduleInfiniteProps {
  onBooking?: (offeringId: string) => void;
  showBookingButton?: boolean;
  filters?: OfferingFilters;
}

interface BookingState {
  isBooking: boolean;
  bookingOfferingId?: string;
}

export function ScheduleInfinite({ 
  onBooking, 
  showBookingButton = true, // Default to true to show booking buttons
  filters = {}
}: ScheduleInfiniteProps) {
  const [pageSize] = useState(14); // ~2 weeks of data per load
  const [selectedOffering, setSelectedOffering] = useState<Offering | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [bookingState, setBookingState] = useState<BookingState>({
    isBooking: false
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error
  } = useInfiniteQuery({
    queryKey: ['offerings', filters],
    queryFn: ({ pageParam }) => getOfferingsInfinite(pageParam, pageSize, filters),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextPage : undefined,
    initialPageParam: 0,
    staleTime: 60 * 1000, // 1 minute
  });

  // Flatten all pages into a single array and group by date
  const groupedOfferings = useMemo(() => {
    if (!data) return {};
    
    const allOfferings = data.pages.flatMap(page => page.data);
    
    return allOfferings.reduce((acc, offering) => {
      const date = offering.date;
      if (!acc[date]) {
        acc[date] = [];
      }
      acc[date].push(offering);
      return acc;
    }, {} as Record<string, Offering[]>);
  }, [data]);

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
      case 'social':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'silent':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'guided':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const isFullyBooked = (offering: Offering) => offering.available_slots === 0;
  const isAlmostFull = (offering: Offering) => 
    offering.available_slots <= Math.ceil(offering.total_slots * 0.2) && offering.available_slots > 0;

  const handleCardClick = (offering: Offering) => {
    setSelectedOffering(offering);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedOffering(null);
  };

  const handleBookSession = async (offeringId: string) => {
    setBookingState({
      isBooking: true,
      bookingOfferingId: offeringId
    });

    try {
      if (onBooking) {
        await onBooking(offeringId);
      }
      // Close modal on successful booking
      handleCloseModal();
    } catch (error) {
      console.error('Booking failed:', error);
      // Handle booking error (could show toast notification here)
    } finally {
      setBookingState({
        isBooking: false
      });
    }
  };

  if (isLoading) {
    return <ScheduleInfiniteLoading />;
  }

  if (error) {
    console.error(error);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unable to Load Schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            We&apos;re having trouble loading the schedule. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (Object.keys(groupedOfferings).length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">NO UPCOMING SESSIONS AVAILABLE.</p>
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
                    className={`transition-all hover:shadow-md cursor-pointer ${
                      isFullyBooked(offering) ? 'opacity-60' : 'hover:shadow-lg'
                    }`}
                    onClick={() => handleCardClick(offering)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-base font-mono-bold">
                          {formatTime(offering.time)}
                        </CardTitle>
                        <Badge 
                          variant="outline" 
                          className={getSessionTypeColor(offering.session_type)}
                        >
                          {offering.session_type}
                        </Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>{offering.duration_minutes ?? 90} min</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <div className="text-sm text-muted-foreground font-sans">
                          @ {offering.location?.name}
                        </div>
                        {/* Show truncated description instead of address */}
                        {offering.description && (
                          <div className="text-sm text-muted-foreground font-sans whitespace-pre-line">
                            {truncateToLines(offering.description, 2)}
                          </div>
                        )}
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <div className="text-lg font-semibold font-mono-bold">
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
                            <span className="text-muted-foreground font-sans">
                              {offering.available_slots} of {offering.total_slots} available
                            </span>
                          )}
                        </div>
                      </div>

                      {showBookingButton && (
                        <Button 
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent card click when button is clicked
                            handleBookSession(offering.id);
                          }}
                          disabled={isFullyBooked(offering) || (bookingState.isBooking && bookingState.bookingOfferingId === offering.id)}
                          className="w-full"
                        >
                          {bookingState.isBooking && bookingState.bookingOfferingId === offering.id ? (
                            'Booking...'
                          ) : isFullyBooked(offering) ? (
                            'FULLY BOOKED'
                          ) : (
                            'BOOK'
                          )}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          </div>
        ))}

      {/* Load More Button */}
      {hasNextPage && (
        <div className="flex justify-center pt-8">
          <Button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            variant="outline"
            className="px-8"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading more sessions...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Load More Sessions
              </>
            )}
          </Button>
        </div>
      )}

      {/* Session Details Modal */}
      <SessionDetailsModal
        offering={selectedOffering}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onBook={onBooking ? handleBookSession : undefined}
        isBooking={bookingState.isBooking && bookingState.bookingOfferingId === selectedOffering?.id}
      />
    </div>
  );
}

function ScheduleInfiniteLoading() {
  return (
    <div className="space-y-8">
      {[1, 2].map((day) => (
        <div key={day} className="space-y-4">
          <div className="h-6 bg-muted rounded w-48 animate-pulse" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((item) => (
              <Card key={item} className="animate-pulse">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="h-4 bg-muted rounded w-16" />
                    <div className="h-6 bg-muted rounded w-24" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-32" />
                    <div className="h-4 bg-muted rounded w-48" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="h-6 bg-muted rounded w-16" />
                    <div className="h-4 bg-muted rounded w-24" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
