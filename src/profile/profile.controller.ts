import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { GemloginService } from './gemlogin.service';
import { CreateProfileDto } from './dto/create-profile.dto';

@Controller('profiles')
export class ProfileController {
    constructor(private readonly gemlogin: GemloginService) { }

    /* =========================
       CREATE
       ========================= */
    @Post('create')
    create(@Body() dto: CreateProfileDto) {
        return this.gemlogin.createProfile(dto);
    }

    /* =========================
       DELETE
       ========================= */
    @Delete('delete-all')
    deleteAll() {
        return this.gemlogin.deleteAllProfiles();
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.gemlogin.deleteProfile(id);
    }
    @Post('start-all')
    startAll() {
        return this.gemlogin.startAllProfiles();
    }
    @Post('close-all')
    closeAll() {
        return this.gemlogin.closeAllProfiles();
    }

    @Get('state')
    getState() {
        return this.gemlogin.getProfilesState();
    }

    @Post('free-ram')
    freeRam() {
        return this.gemlogin.freeRam();
    }

}
