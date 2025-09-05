"use client";

import { Offering } from "@/lib/database.types";
import { formatMultilineText } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MapPin, Clock, Users, DollarSign } from "lucide-react";

interface SessionDetailsModalProps {
  offering: Offering | null;
  isOpen: boolean;
  onClose: () => void;
  onBook?: (offeringId: string) => void;
  isBooking?: boolean;
}

export function SessionDetailsModal({ 
  offering, 
  isOpen, 
  onClose, 
  onBook,
  isBooking = false
}: SessionDetailsModalProps) {
  if (!offering) return null;

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
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

  const isFullyBooked = offering.available_slots === 0;
  const isAlmostFull = offering.available_slots <= Math.ceil(offering.total_slots * 0.2) && offering.available_slots > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="font-sans text-xl">Session Details</DialogTitle>
            <Badge 
              variant="outline" 
              className={getSessionTypeColor(offering.session_type)}
            >
              {offering.session_type}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Date and Time */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-medium font-sans">{formatDate(offering.date)}</div>
                <div className="text-lg font-semibold text-primary">
                  {formatTime(offering.time)}
                </div>
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="flex items-start gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
            <div>
              <div className="font-medium font-sans">{offering.location?.name}</div>
              <div className="text-sm text-muted-foreground font-sans">
                {offering.location?.address}
              </div>
            </div>
          </div>

          {/* Description */}
          {offering.description && (
            <div>
              <h4 className="font-medium font-sans mb-2">About This Session</h4>
              <div className="text-sm text-muted-foreground font-sans whitespace-pre-line">
                {formatMultilineText(offering.description)}
              </div>
            </div>
          )}

          {/* Pricing and Availability */}
          <div className="bg-muted/30 p-4 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <span className="font-sans">Price</span>
              </div>
              <span className="text-lg font-semibold">
                ${offering.cost.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="font-sans">Availability</span>
              </div>
              <div className="text-right">
                {isFullyBooked ? (
                  <Badge variant="destructive">Fully Booked</Badge>
                ) : isAlmostFull ? (
                  <Badge variant="secondary">
                    Only {offering.available_slots} left
                  </Badge>
                ) : (
                  <span className="text-sm text-muted-foreground font-sans">
                    {offering.available_slots} of {offering.total_slots} available
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Book Session Button */}
          {onBook && (
            <Button 
              onClick={() => onBook(offering.id)}
              disabled={isFullyBooked || isBooking}
              className="w-full"
              size="lg"
            >
              {isBooking ? (
                'Booking...'
              ) : isFullyBooked ? (
                'Session Fully Booked'
              ) : (
                'Book This Session'
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}