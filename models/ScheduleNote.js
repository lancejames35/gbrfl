const db = require('../config/database');

class ScheduleNote {
  /**
   * Get all schedule notes for a specific week
   * @param {number} weekNumber - The week number (1-17)
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of schedule notes for the week
   */
  static async getNotesByWeek(weekNumber, seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          sn.note_id,
          sn.week_number,
          sn.note_text,
          sn.note_type,
          sn.is_active,
          sn.season_year,
          sn.created_at
        FROM schedule_notes sn
        WHERE sn.week_number = ? AND sn.season_year = ?
        ORDER BY sn.created_at
      `;
      
      const notes = await db.query(query, [weekNumber, seasonYear]);
      return notes;
    } catch (error) {
      console.error('Error fetching notes by week:', error);
      throw error;
    }
  }

  /**
   * Get all active schedule notes for the current season
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of all active schedule notes
   */
  static async getAllActiveNotes(seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          sn.note_id,
          sn.week_number,
          sn.note_text,
          sn.note_type,
          sn.is_active,
          sn.season_year,
          sn.created_at
        FROM schedule_notes sn
        WHERE sn.is_active = 1 AND sn.season_year = ?
        ORDER BY sn.week_number, sn.created_at
      `;
      
      const notes = await db.query(query, [seasonYear]);
      
      // Group by week
      const notesByWeek = {};
      notes.forEach(note => {
        if (!notesByWeek[note.week_number]) {
          notesByWeek[note.week_number] = [];
        }
        notesByWeek[note.week_number].push(note);
      });
      
      return notesByWeek;
    } catch (error) {
      console.error('Error fetching all active notes:', error);
      throw error;
    }
  }

  /**
   * Get all notes (active and inactive) for the current season
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of all schedule notes
   */
  static async getAllNotes(seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          sn.note_id,
          sn.week_number,
          sn.note_text,
          sn.note_type,
          sn.is_active,
          sn.season_year,
          sn.created_at
        FROM schedule_notes sn
        WHERE sn.season_year = ?
        ORDER BY sn.week_number, sn.created_at
      `;
      
      const notes = await db.query(query, [seasonYear]);
      return notes;
    } catch (error) {
      console.error('Error fetching all notes:', error);
      throw error;
    }
  }

  /**
   * Create a new schedule note
   * @param {Object} noteData - The note data
   * @returns {Promise<Object>} Created note
   */
  static async createNote(noteData) {
    try {
      const { 
        week_number, 
        note_text, 
        note_type = 'announcement', 
        season_year = 2025 
      } = noteData;
      
      const query = `
        INSERT INTO schedule_notes (
          week_number, 
          note_text, 
          note_type, 
          season_year
        )
        VALUES (?, ?, ?, ?)
      `;
      
      const result = await db.query(query, [
        week_number, 
        note_text, 
        note_type, 
        season_year
      ]);
      
      return {
        note_id: result.insertId,
        week_number,
        note_text,
        note_type,
        season_year,
        is_active: 1
      };
    } catch (error) {
      console.error('Error creating schedule note:', error);
      throw error;
    }
  }

  /**
   * Update an existing schedule note
   * @param {number} noteId - The note ID
   * @param {Object} updateData - The data to update
   * @returns {Promise<boolean>} Success status
   */
  static async updateNote(noteId, updateData) {
    try {
      const { note_text, note_type, is_active } = updateData;
      
      let setParts = [];
      let params = [];
      
      if (note_text !== undefined) {
        setParts.push('note_text = ?');
        params.push(note_text);
      }
      if (note_type !== undefined) {
        setParts.push('note_type = ?');
        params.push(note_type);
      }
      if (is_active !== undefined) {
        setParts.push('is_active = ?');
        params.push(is_active ? 1 : 0);
      }
      
      if (setParts.length === 0) {
        return false;
      }
      
      params.push(noteId);
      
      const query = `
        UPDATE schedule_notes
        SET ${setParts.join(', ')}
        WHERE note_id = ?
      `;
      
      const result = await db.query(query, params);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error updating schedule note:', error);
      throw error;
    }
  }

  /**
   * Delete a schedule note
   * @param {number} noteId - The note ID
   * @returns {Promise<boolean>} Success status
   */
  static async deleteNote(noteId) {
    try {
      const query = 'DELETE FROM schedule_notes WHERE note_id = ?';
      const result = await db.query(query, [noteId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error deleting schedule note:', error);
      throw error;
    }
  }

  /**
   * Soft delete a schedule note (set is_active to 0)
   * @param {number} noteId - The note ID
   * @returns {Promise<boolean>} Success status
   */
  static async softDeleteNote(noteId) {
    try {
      const query = `
        UPDATE schedule_notes
        SET is_active = 0
        WHERE note_id = ?
      `;
      
      const result = await db.query(query, [noteId]);
      return result.affectedRows > 0;
    } catch (error) {
      console.error('Error soft deleting schedule note:', error);
      throw error;
    }
  }

  /**
   * Get a specific note by ID
   * @param {number} noteId - The note ID
   * @returns {Promise<Object|null>} Note or null
   */
  static async getNoteById(noteId) {
    try {
      const query = `
        SELECT 
          sn.*
        FROM schedule_notes sn
        WHERE sn.note_id = ?
        LIMIT 1
      `;
      
      const results = await db.query(query, [noteId]);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      console.error('Error fetching note by ID:', error);
      throw error;
    }
  }

  /**
   * Get notes by type
   * @param {string} noteType - The note type ('announcement', 'deadline', 'fee_due', 'trading_deadline')
   * @param {number} seasonYear - The season year (default: 2025)
   * @returns {Promise<Array>} Array of notes of the specified type
   */
  static async getNotesByType(noteType, seasonYear = 2025) {
    try {
      const query = `
        SELECT 
          sn.*
        FROM schedule_notes sn
        WHERE sn.note_type = ? AND sn.season_year = ? AND sn.is_active = 1
        ORDER BY sn.week_number, sn.created_at
      `;
      
      const notes = await db.query(query, [noteType, seasonYear]);
      return notes;
    } catch (error) {
      console.error('Error fetching notes by type:', error);
      throw error;
    }
  }
}

module.exports = ScheduleNote;