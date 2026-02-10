import { BadRequestException, Controller, Post, Body, Param, Get, Put, UseGuards, Req, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { AuthService } from '../auth/auth.service';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiBody } from '@nestjs/swagger';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService,
  ) {}

  @ApiOperation({ summary: 'Проверка работоспособности API' })
  @Get('status')
  getStatus() {
    return { status: 'alive', message: 'AI Gen Lab API is running' };
  }

  @ApiOperation({ summary: 'Получение данных текущего пользователя по токену' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@Req() req) {
    return this.usersService.findById(req.user.userId);
  }

  @ApiOperation({ summary: 'Регистрация нового пользователя' })
  @Post('register')
  async register(@Body() dto: CreateUserDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new BadRequestException('Email already taken');

    const user = await this.usersService.create(dto);
    const tokenData = await this.authService.generateToken(user);

    return {
      message: 'Registered',
      user: await this.usersService.findById(user.id),
      access_token: tokenData.access_token,
    };
  }

  @ApiOperation({ summary: 'Получение профиля пользователя по ID' })
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID пользователя' })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async getProfile(@Param('id') id: string, @Req() req) {
    if (id !== req.user.userId) throw new UnauthorizedException('Access denied');
    return this.usersService.findById(id);
  }

  @ApiOperation({ summary: 'Генерация изображения (проверка лимитов)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('generate-image')
  async generateImage(@Req() req) {
    return this.usersService.generateImage(req.user.userId);
  }

  @ApiOperation({ summary: 'Обновление профиля (Flat Mass Assignment)' })
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID пользователя' })
  @ApiBody({ schema: { example: { plan: 'pro', generationCredits: 999 } } })
  @UseGuards(JwtAuthGuard)
  @Put(':id/flat')
  async updateFlat(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.usersService.updateFlat(id, body, req.user.userId);
  }

  @ApiOperation({ summary: 'Обновление профиля (Full Object Mass Assignment — для теста Reflected/Persisted)' })
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID пользователя' })
  @ApiBody({ schema: { example: { plan: 'pro', generationCredits: 999 } } })
  @UseGuards(JwtAuthGuard)
  @Put(':id/full')
  async updateFull(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.usersService.updateFull(id, body, req.user.userId);
  }

  @ApiOperation({ summary: 'Обновление профиля (Nested Mass Assignment)' })
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID пользователя' })
  @ApiBody({ schema: { example: { features: { unlimitedGenerations: true } } } })
  @UseGuards(JwtAuthGuard)
  @Put(':id/nested')
  async updateNested(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.usersService.updateNested(id, body, req.user.userId);
  }

  @ApiOperation({ summary: 'Защищенное обновление профиля (Zod + Whitelist)' })
  @ApiBearerAuth()
  @ApiParam({ name: 'id', description: 'ID пользователя' })
  @ApiBody({ schema: { example: { fullName: 'New Name', profile: { bio: 'New Bio' } } } })
  @UseGuards(JwtAuthGuard)
  @Put(':id/safe')
  async safeUpdate(@Param('id') id: string, @Body() body: unknown, @Req() req) {
    return this.usersService.safeUpdate(id, body, req.user.userId);
  }
}